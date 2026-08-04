import type { createDb } from '@server/db/client'
import { manualDownloadTasks, releaseSearchJobs, releaseSearchResults } from '@server/db/schema'
import type {
  ManualDownloadTaskRecord,
  ReleaseSearchJobRecord,
  ReleaseSearchResultRecord,
  ResourceApiRepo,
} from '@server/usecases/ports'
import type { CreateDownloadResult, IndexerSearchItem } from '@shared/types'
import { and, count, desc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'

type Db = ReturnType<typeof createDb>

export function createResourceApiRepo(db: Db): ResourceApiRepo {
  return {
    async findReleaseJobByIdempotency(userId, key) {
      const rows = await db
        .select()
        .from(releaseSearchJobs)
        .where(and(eq(releaseSearchJobs.userId, userId), eq(releaseSearchJobs.idempotencyKey, key)))
        .limit(1)
      return rows[0] ? mapReleaseJob(rows[0]) : null
    },
    async createReleaseJob(record) {
      const rows = await db
        .insert(releaseSearchJobs)
        .values({ ...record, categoriesJson: JSON.stringify(record.categories) })
        .onConflictDoNothing()
        .returning({ id: releaseSearchJobs.id })
      return rows.length === 1
    },
    async claimReleaseJob(id, leaseOwner, now, leaseExpiresAt) {
      const rows = await db
        .update(releaseSearchJobs)
        .set({ leaseOwner, leaseExpiresAt })
        .where(
          and(
            eq(releaseSearchJobs.id, id),
            eq(releaseSearchJobs.status, 'running'),
            or(isNull(releaseSearchJobs.leaseExpiresAt), lt(releaseSearchJobs.leaseExpiresAt, now)),
          ),
        )
        .returning({ id: releaseSearchJobs.id })
      if (rows.length !== 1) return false
      await db.delete(releaseSearchResults).where(eq(releaseSearchResults.jobId, id))
      return true
    },
    async completeReleaseJob(id, leaseOwner, items, now) {
      for (const [position, item] of items.entries()) {
        await db.run(sql`
          INSERT INTO release_search_results (id, job_id, position, payload_json, created_at)
          SELECT ${crypto.randomUUID()}, ${id}, ${position}, ${JSON.stringify(item)}, ${now}
          WHERE EXISTS (
            SELECT 1 FROM release_search_jobs
            WHERE id = ${id} AND status = 'running' AND lease_owner = ${leaseOwner}
          )
          ON CONFLICT(job_id, position) DO NOTHING
        `)
      }
      const rows = await db
        .update(releaseSearchJobs)
        .set({ status: 'completed', completedAt: now, leaseOwner: null, leaseExpiresAt: null })
        .where(
          and(
            eq(releaseSearchJobs.id, id),
            eq(releaseSearchJobs.status, 'running'),
            eq(releaseSearchJobs.leaseOwner, leaseOwner),
          ),
        )
        .returning({ id: releaseSearchJobs.id })
      return rows.length === 1
    },
    async failReleaseJob(id, leaseOwner, error, now) {
      await db.run(sql`
        DELETE FROM release_search_results
        WHERE job_id = ${id}
          AND EXISTS (
            SELECT 1 FROM release_search_jobs
            WHERE id = ${id} AND status = 'running' AND lease_owner = ${leaseOwner}
          )
      `)
      const rows = await db
        .update(releaseSearchJobs)
        .set({ status: 'failed', error, completedAt: now, leaseOwner: null, leaseExpiresAt: null })
        .where(
          and(
            eq(releaseSearchJobs.id, id),
            eq(releaseSearchJobs.status, 'running'),
            eq(releaseSearchJobs.leaseOwner, leaseOwner),
          ),
        )
        .returning({ id: releaseSearchJobs.id })
      return rows.length === 1
    },
    async getReleaseJob(userId, id) {
      const rows = await db
        .select()
        .from(releaseSearchJobs)
        .where(and(eq(releaseSearchJobs.userId, userId), eq(releaseSearchJobs.id, id)))
        .limit(1)
      return rows[0] ? mapReleaseJob(rows[0]) : null
    },
    async listReleaseJobs(userId, page, pageSize) {
      const [items, totals] = await Promise.all([
        db
          .select()
          .from(releaseSearchJobs)
          .where(eq(releaseSearchJobs.userId, userId))
          .orderBy(desc(releaseSearchJobs.createdAt), desc(releaseSearchJobs.id))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db.select({ value: count() }).from(releaseSearchJobs).where(eq(releaseSearchJobs.userId, userId)),
      ])
      return { items: items.map(mapReleaseJob), total: totals[0]?.value ?? 0 }
    },
    async listReleaseResults(userId, jobId, page, pageSize) {
      const ownership = and(
        eq(releaseSearchJobs.userId, userId),
        eq(releaseSearchJobs.status, 'completed'),
        eq(releaseSearchResults.jobId, jobId),
      )
      const [items, totals] = await Promise.all([
        db
          .select({ result: releaseSearchResults })
          .from(releaseSearchResults)
          .innerJoin(releaseSearchJobs, eq(releaseSearchResults.jobId, releaseSearchJobs.id))
          .where(ownership)
          .orderBy(releaseSearchResults.position)
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db
          .select({ value: count() })
          .from(releaseSearchResults)
          .innerJoin(releaseSearchJobs, eq(releaseSearchResults.jobId, releaseSearchJobs.id))
          .where(ownership),
      ])
      return { items: items.map(({ result }) => mapReleaseResult(result)), total: totals[0]?.value ?? 0 }
    },
    async getReleaseResult(userId, id) {
      const rows = await db
        .select({ result: releaseSearchResults })
        .from(releaseSearchResults)
        .innerJoin(releaseSearchJobs, eq(releaseSearchResults.jobId, releaseSearchJobs.id))
        .where(
          and(
            eq(releaseSearchResults.id, id),
            eq(releaseSearchJobs.userId, userId),
            eq(releaseSearchJobs.status, 'completed'),
          ),
        )
        .limit(1)
      return rows[0] ? mapReleaseResult(rows[0].result) : null
    },
    async findDownloadTaskByIdempotency(userId, key) {
      const rows = await db
        .select()
        .from(manualDownloadTasks)
        .where(and(eq(manualDownloadTasks.userId, userId), eq(manualDownloadTasks.idempotencyKey, key)))
        .limit(1)
      return rows[0] ? mapDownloadTask(rows[0]) : null
    },
    async createDownloadTask(record) {
      const rows = await db
        .insert(manualDownloadTasks)
        .values(record)
        .onConflictDoNothing()
        .returning({ id: manualDownloadTasks.id })
      return rows.length === 1
    },
    async markDownloadTaskSubmitted(id, result: CreateDownloadResult) {
      const rows = await db
        .update(manualDownloadTasks)
        .set({ status: 'submitted', externalTaskId: result.externalTaskId ?? null, completedAt: null })
        .where(and(eq(manualDownloadTasks.id, id), eq(manualDownloadTasks.status, 'submitting')))
        .returning({ id: manualDownloadTasks.id })
      return rows.length === 1
    },
    async syncDownloadTask(id, snapshot, status, completedAt) {
      const allowedCurrentStatuses: Array<'submitted' | 'running'> =
        status === 'submitted' ? ['submitted'] : ['submitted', 'running']
      const monotonicSnapshot = snapshot.downstreamRevision
        ? or(
            isNull(manualDownloadTasks.downstreamRevision),
            lt(manualDownloadTasks.downstreamRevision, snapshot.downstreamRevision),
          )
        : and(
            lte(manualDownloadTasks.downloadedBytes, snapshot.downloadedBytes),
            lte(manualDownloadTasks.storageUploadedBytes, snapshot.storageUploadedBytes),
          )
      const rows = await db
        .update(manualDownloadTasks)
        .set({
          status,
          downstreamStatus: snapshot.status,
          downstreamRevision: snapshot.downstreamRevision ?? null,
          downloadedBytes: snapshot.downloadedBytes,
          storageUploadedBytes: snapshot.storageUploadedBytes,
          totalBytes: snapshot.totalBytes,
          downloadBps: snapshot.downloadBps,
          storageUploadBps: snapshot.storageUploadBps,
          resultObjectId: snapshot.outputObjectId ?? null,
          resultName: status === 'completed' ? snapshot.name : null,
          resultTargetFolder: status === 'completed' ? snapshot.targetFolder : null,
          error: snapshot.errorMessage,
          completedAt,
        })
        .where(
          and(
            eq(manualDownloadTasks.id, id),
            inArray(manualDownloadTasks.status, allowedCurrentStatuses),
            monotonicSnapshot,
          ),
        )
        .returning({ id: manualDownloadTasks.id })
      return rows.length === 1
    },
    async failDownloadTask(id, error, now) {
      const rows = await db
        .update(manualDownloadTasks)
        .set({ status: 'failed', error, completedAt: now })
        .where(and(eq(manualDownloadTasks.id, id), eq(manualDownloadTasks.status, 'submitting')))
        .returning({ id: manualDownloadTasks.id })
      return rows.length === 1
    },
    async getDownloadTask(userId, id) {
      const rows = await db
        .select()
        .from(manualDownloadTasks)
        .where(and(eq(manualDownloadTasks.userId, userId), eq(manualDownloadTasks.id, id)))
        .limit(1)
      return rows[0] ? mapDownloadTask(rows[0]) : null
    },
    async listDownloadTasks(userId, page, pageSize) {
      const [items, totals] = await Promise.all([
        db
          .select()
          .from(manualDownloadTasks)
          .where(eq(manualDownloadTasks.userId, userId))
          .orderBy(desc(manualDownloadTasks.createdAt), desc(manualDownloadTasks.id))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db.select({ value: count() }).from(manualDownloadTasks).where(eq(manualDownloadTasks.userId, userId)),
      ])
      return { items: items.map(mapDownloadTask), total: totals[0]?.value ?? 0 }
    },
  }
}

function mapReleaseJob(row: typeof releaseSearchJobs.$inferSelect): ReleaseSearchJobRecord {
  const { categoriesJson: _categoriesJson, ...record } = row
  return { ...record, categories: JSON.parse(row.categoriesJson) as number[] }
}

function mapReleaseResult(row: typeof releaseSearchResults.$inferSelect): ReleaseSearchResultRecord {
  return {
    id: row.id,
    jobId: row.jobId,
    position: row.position,
    item: JSON.parse(row.payloadJson) as IndexerSearchItem,
    createdAt: row.createdAt,
  }
}

function mapDownloadTask(row: typeof manualDownloadTasks.$inferSelect): ManualDownloadTaskRecord {
  return row
}
