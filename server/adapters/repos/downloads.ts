import type { createDb } from '@server/db/client'
import { downloads } from '@server/db/schema'
import type { DownloadRecord, DownloadsRepo } from '@server/usecases/ports'
import { and, count, desc, eq, isNotNull, notInArray } from 'drizzle-orm'

type Db = ReturnType<typeof createDb>

export function createDownloadsRepo(db: Db): DownloadsRepo {
  return {
    async findByIdempotency(userId, key) {
      const rows = await db
        .select()
        .from(downloads)
        .where(and(eq(downloads.userId, userId), eq(downloads.idempotencyKey, key)))
        .limit(1)
      return rows[0] ? mapDownload(rows[0]) : null
    },
    async create(record) {
      const rows = await db
        .insert(downloads)
        .values(toRow(record))
        .onConflictDoNothing()
        .returning({ id: downloads.id })
      return rows.length === 1
    },
    async get(userId, id) {
      const rows = await db
        .select()
        .from(downloads)
        .where(and(eq(downloads.userId, userId), eq(downloads.id, id)))
        .limit(1)
      return rows[0] ? mapDownload(rows[0]) : null
    },
    async listReconciliationCandidates(limit) {
      const rows = await db
        .select()
        .from(downloads)
        .where(
          and(isNotNull(downloads.externalTaskId), notInArray(downloads.status, ['completed', 'failed', 'canceled'])),
        )
        .orderBy(downloads.updatedAt)
        .limit(limit)
      return rows.map(mapDownload)
    },
    async list(userId, input) {
      const where = and(eq(downloads.userId, userId), input.status ? eq(downloads.status, input.status) : undefined)
      const [items, totals] = await Promise.all([
        db
          .select()
          .from(downloads)
          .where(where)
          .orderBy(desc(downloads.createdAt), desc(downloads.id))
          .limit(input.pageSize)
          .offset((input.page - 1) * input.pageSize),
        db.select({ value: count() }).from(downloads).where(where),
      ])
      return { items: items.map(mapDownload), total: totals[0]?.value ?? 0 }
    },
    async update(userId, id, expectedUpdatedAt, patch) {
      const { spec, ...values } = patch
      const updatedAt = nextRevision(expectedUpdatedAt)
      const rows = await db
        .update(downloads)
        .set({ ...values, specJson: spec ? JSON.stringify(spec) : undefined, updatedAt })
        .where(and(eq(downloads.userId, userId), eq(downloads.id, id), eq(downloads.updatedAt, expectedUpdatedAt)))
        .returning()
      return rows[0] ? mapDownload(rows[0]) : null
    },
    async delete(userId, id, expectedUpdatedAt) {
      const rows = await db
        .delete(downloads)
        .where(and(eq(downloads.userId, userId), eq(downloads.id, id), eq(downloads.updatedAt, expectedUpdatedAt)))
        .returning({ id: downloads.id })
      return rows.length === 1
    },
  }
}

function nextRevision(previous: string): string {
  const now = Date.now()
  const previousTime = Date.parse(previous)
  return new Date(Number.isNaN(previousTime) ? now : Math.max(now, previousTime + 1)).toISOString()
}

function mapDownload(row: typeof downloads.$inferSelect): DownloadRecord {
  return { ...row, spec: JSON.parse(row.specJson) as DownloadRecord['spec'] }
}

function toRow(record: DownloadRecord): typeof downloads.$inferInsert {
  const { spec, ...row } = record
  return { ...row, specJson: JSON.stringify(spec) }
}
