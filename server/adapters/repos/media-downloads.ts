import type { createDb } from '@server/db/client'
import { dispatchLanes, downloadRecords, mediaSubscriptions, subscriptionDownloadRecords } from '@server/db/schema'
import type {
  DispatchLanesRepo,
  DownloadRecordRecord,
  DownloadRecordsRepo,
  MediaSubscriptionRecord,
  MediaSubscriptionsRepo,
} from '@server/usecases/ports'
import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'

type Db = ReturnType<typeof createDb>
const D1_MAX_BOUND_PARAMETERS = 100
const D1_WRITE_ID_CHUNK_SIZE = 90

export function createMediaSubscriptionsRepo(db: Db): MediaSubscriptionsRepo {
  async function find(
    userId: string,
    subjectType: MediaSubscriptionRecord['subjectType'],
    subjectKey: string,
  ): Promise<MediaSubscriptionRecord | null> {
    const rows = await db
      .select()
      .from(mediaSubscriptions)
      .where(
        and(
          eq(mediaSubscriptions.userId, userId),
          eq(mediaSubscriptions.subjectType, subjectType),
          eq(mediaSubscriptions.subjectKey, subjectKey),
        ),
      )
      .limit(1)
    return rows[0] ? toSubscription(rows[0]) : null
  }

  return {
    async find(userId, subjectType, subjectKey) {
      return find(userId, subjectType, subjectKey)
    },

    async get(id) {
      const rows = await db.select().from(mediaSubscriptions).where(eq(mediaSubscriptions.id, id)).limit(1)
      return rows[0] ? toSubscription(rows[0]) : null
    },

    async upsertMusicCollection(userId, collectionId, input) {
      const row: typeof mediaSubscriptions.$inferInsert = {
        id: crypto.randomUUID(),
        userId,
        subjectType: 'music_collection',
        subjectKey: collectionId,
        downloaderId: input.downloaderId,
        configJson: '{}',
        enabled: true,
        lastEvaluatedAt: null,
        createdAt: input.now,
        updatedAt: input.now,
      }
      const rows = await db
        .insert(mediaSubscriptions)
        .values(row)
        .onConflictDoUpdate({
          target: [mediaSubscriptions.userId, mediaSubscriptions.subjectType, mediaSubscriptions.subjectKey],
          set: {
            downloaderId: input.downloaderId,
            configJson: '{}',
            enabled: true,
            updatedAt: input.now,
          },
        })
        .returning()
      return toSubscription(rows[0])
    },

    async disable(userId, id, now) {
      const rows = await db
        .update(mediaSubscriptions)
        .set({ enabled: false, updatedAt: now })
        .where(and(eq(mediaSubscriptions.id, id), eq(mediaSubscriptions.userId, userId)))
        .returning()
      return rows[0] ? toSubscription(rows[0]) : null
    },

    async markEvaluated(id, evaluatedAt) {
      await db
        .update(mediaSubscriptions)
        .set({ lastEvaluatedAt: evaluatedAt, updatedAt: evaluatedAt })
        .where(eq(mediaSubscriptions.id, id))
    },
  }
}

export function createDownloadRecordsRepo(db: Db): DownloadRecordsRepo {
  return {
    async listByResourceKeys(userId, resourceKind, resourceKeys) {
      const rows: Array<typeof downloadRecords.$inferSelect> = []
      for (const keys of chunks(resourceKeys, D1_MAX_BOUND_PARAMETERS - 2)) {
        rows.push(
          ...(await db
            .select()
            .from(downloadRecords)
            .where(
              and(
                eq(downloadRecords.userId, userId),
                eq(downloadRecords.resourceKind, resourceKind),
                inArray(downloadRecords.resourceKey, keys),
              ),
            )),
        )
      }
      return rows.map(toDownloadRecord)
    },

    async get(id) {
      const rows = await db.select().from(downloadRecords).where(eq(downloadRecords.id, id)).limit(1)
      return rows[0] ? toDownloadRecord(rows[0]) : null
    },

    async create(record) {
      const rows = await db
        .insert(downloadRecords)
        .values(toDownloadRow(record))
        .onConflictDoNothing()
        .returning({ id: downloadRecords.id })
      return rows.length > 0
    },

    async createMany(records) {
      for (const batch of chunks(records, 5)) {
        await db.insert(downloadRecords).values(batch.map(toDownloadRow)).onConflictDoNothing()
      }
    },

    async linkSubscription(subscriptionId, downloadRecordId, createdAt) {
      await db
        .insert(subscriptionDownloadRecords)
        .values({ subscriptionId, downloadRecordId, createdAt })
        .onConflictDoNothing()
    },

    async linkSubscriptionMany(subscriptionId, downloadRecordIds, createdAt) {
      for (const ids of chunks(downloadRecordIds, 30)) {
        await db
          .insert(subscriptionDownloadRecords)
          .values(ids.map((downloadRecordId) => ({ subscriptionId, downloadRecordId, createdAt })))
          .onConflictDoNothing()
      }
    },

    async update(id, generation, patch) {
      const { config, ...values } = patch
      const rows = await db
        .update(downloadRecords)
        .set({
          ...values,
          configJson: config ? JSON.stringify(config) : undefined,
        })
        .where(and(eq(downloadRecords.id, id), eq(downloadRecords.generation, generation)))
        .returning()
      return rows[0] ? toDownloadRecord(rows[0]) : null
    },

    async claimNext(laneKey, claimedAt) {
      const rows = await db
        .select()
        .from(downloadRecords)
        .where(and(eq(downloadRecords.laneKey, laneKey), eq(downloadRecords.status, 'queued')))
        .orderBy(downloadRecords.createdAt)
        .limit(1)
      const current = rows[0]
      if (!current) return null

      const claimed = await db
        .update(downloadRecords)
        .set({
          status: 'resolving',
          attemptCount: sql`${downloadRecords.attemptCount} + 1`,
          errorMessage: null,
          updatedAt: claimedAt,
        })
        .where(
          and(
            eq(downloadRecords.id, current.id),
            eq(downloadRecords.generation, current.generation),
            eq(downloadRecords.status, 'queued'),
          ),
        )
        .returning()
      return claimed[0] ? toDownloadRecord(claimed[0]) : null
    },

    async isWanted(id) {
      const records = await db
        .select({ manualRequestedAt: downloadRecords.manualRequestedAt })
        .from(downloadRecords)
        .where(eq(downloadRecords.id, id))
        .limit(1)
      if (records[0]?.manualRequestedAt) return true

      const active = await db
        .select({ id: mediaSubscriptions.id })
        .from(subscriptionDownloadRecords)
        .innerJoin(mediaSubscriptions, eq(subscriptionDownloadRecords.subscriptionId, mediaSubscriptions.id))
        .where(and(eq(subscriptionDownloadRecords.downloadRecordId, id), eq(mediaSubscriptions.enabled, true)))
        .limit(1)
      return active.length > 0
    },

    async cancelUnwantedForSubscription(subscriptionId, canceledAt) {
      const linked = await db
        .select({ record: downloadRecords })
        .from(subscriptionDownloadRecords)
        .innerJoin(downloadRecords, eq(subscriptionDownloadRecords.downloadRecordId, downloadRecords.id))
        .where(eq(subscriptionDownloadRecords.subscriptionId, subscriptionId))
      const candidates = linked
        .map(({ record }) => record)
        .filter(
          (record) => !record.manualRequestedAt && (record.status === 'queued' || record.status === 'waiting_source'),
        )
      if (candidates.length === 0) return 0

      const activeIds = new Set<string>()
      for (const ids of chunks(
        candidates.map((record) => record.id),
        D1_MAX_BOUND_PARAMETERS - 1,
      )) {
        const active = await db
          .selectDistinct({ id: subscriptionDownloadRecords.downloadRecordId })
          .from(subscriptionDownloadRecords)
          .innerJoin(mediaSubscriptions, eq(subscriptionDownloadRecords.subscriptionId, mediaSubscriptions.id))
          .where(and(inArray(subscriptionDownloadRecords.downloadRecordId, ids), eq(mediaSubscriptions.enabled, true)))
        for (const row of active) activeIds.add(row.id)
      }

      const cancelIds = candidates.filter((record) => !activeIds.has(record.id)).map((record) => record.id)
      let canceled = 0
      for (const ids of chunks(cancelIds, D1_WRITE_ID_CHUNK_SIZE)) {
        const rows = await db
          .update(downloadRecords)
          .set({ status: 'canceled', errorMessage: null, updatedAt: canceledAt })
          .where(and(inArray(downloadRecords.id, ids), inArray(downloadRecords.status, ['queued', 'waiting_source'])))
          .returning({ id: downloadRecords.id })
        canceled += rows.length
      }
      return canceled
    },

    async hasQueued(laneKey) {
      const rows = await db
        .select({ id: downloadRecords.id })
        .from(downloadRecords)
        .where(and(eq(downloadRecords.laneKey, laneKey), eq(downloadRecords.status, 'queued')))
        .limit(1)
      return rows.length > 0
    },

    async listRecoverableLaneKeys() {
      const rows = await db
        .selectDistinct({ laneKey: downloadRecords.laneKey })
        .from(downloadRecords)
        .where(eq(downloadRecords.status, 'queued'))
      return rows.map((row) => row.laneKey)
    },

    async requeueStalled(laneKey, staleBefore, queuedAt) {
      const stalledFilter = and(
        inArray(downloadRecords.status, ['resolving', 'submitting']),
        lte(downloadRecords.updatedAt, staleBefore),
        laneKey ? eq(downloadRecords.laneKey, laneKey) : undefined,
      )
      const stalled = await db
        .selectDistinct({ laneKey: downloadRecords.laneKey })
        .from(downloadRecords)
        .where(stalledFilter)
      await db
        .update(downloadRecords)
        .set({ status: 'queued', errorMessage: 'Recovered an interrupted dispatch.', updatedAt: queuedAt })
        .where(stalledFilter)
      return stalled.map((row) => row.laneKey)
    },

    async requeueWaitingForEnabledSubscriptions(queuedAt) {
      const waiting = await db
        .selectDistinct({ id: downloadRecords.id, laneKey: downloadRecords.laneKey })
        .from(downloadRecords)
        .innerJoin(subscriptionDownloadRecords, eq(subscriptionDownloadRecords.downloadRecordId, downloadRecords.id))
        .innerJoin(mediaSubscriptions, eq(subscriptionDownloadRecords.subscriptionId, mediaSubscriptions.id))
        .where(and(eq(downloadRecords.status, 'waiting_source'), eq(mediaSubscriptions.enabled, true)))
      const laneKeys = new Set(waiting.map((row) => row.laneKey))
      for (const ids of chunks(
        waiting.map((row) => row.id),
        D1_WRITE_ID_CHUNK_SIZE,
      )) {
        await db
          .update(downloadRecords)
          .set({ status: 'queued', errorMessage: null, updatedAt: queuedAt })
          .where(and(inArray(downloadRecords.id, ids), eq(downloadRecords.status, 'waiting_source')))
      }
      return [...laneKeys]
    },
  }
}

export function createDispatchLanesRepo(db: Db): DispatchLanesRepo {
  return {
    async acquire(key, owner, acquiredAt, leaseExpiresAt) {
      await db
        .insert(dispatchLanes)
        .values({ key, leaseOwner: null, leaseExpiresAt: null, nextAllowedAt: null, updatedAt: acquiredAt })
        .onConflictDoNothing()

      const rows = await db
        .update(dispatchLanes)
        .set({ leaseOwner: owner, leaseExpiresAt, updatedAt: acquiredAt })
        .where(
          and(
            eq(dispatchLanes.key, key),
            or(isNull(dispatchLanes.leaseExpiresAt), lte(dispatchLanes.leaseExpiresAt, acquiredAt)),
            or(isNull(dispatchLanes.nextAllowedAt), lte(dispatchLanes.nextAllowedAt, acquiredAt)),
          ),
        )
        .returning()
      if (rows[0]) return { lane: rows[0], acquired: true }

      const current = await db.select().from(dispatchLanes).where(eq(dispatchLanes.key, key)).limit(1)
      if (!current[0]) throw new Error(`Dispatch lane disappeared: ${key}`)
      return { lane: current[0], acquired: false }
    },

    async release(key, owner, nextAllowedAt, releasedAt) {
      await db
        .update(dispatchLanes)
        .set({ leaseOwner: null, leaseExpiresAt: null, nextAllowedAt, updatedAt: releasedAt })
        .where(and(eq(dispatchLanes.key, key), eq(dispatchLanes.leaseOwner, owner)))
    },
  }
}

function toSubscription(row: typeof mediaSubscriptions.$inferSelect): MediaSubscriptionRecord {
  return {
    id: row.id,
    userId: row.userId,
    subjectType: row.subjectType,
    subjectKey: row.subjectKey,
    downloaderId: row.downloaderId,
    enabled: row.enabled,
    lastEvaluatedAt: row.lastEvaluatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toDownloadRecord(row: typeof downloadRecords.$inferSelect): DownloadRecordRecord {
  const storedConfig = JSON.parse(row.configJson) as Partial<DownloadRecordRecord['config']>
  if (!storedConfig.preferredQuality) throw new Error(`Download record ${row.id} has invalid config.`)
  return {
    id: row.id,
    userId: row.userId,
    resourceKind: row.resourceKind,
    resourceKey: row.resourceKey,
    laneKey: row.laneKey,
    generation: row.generation,
    downloaderId: row.downloaderId,
    config: {
      preferredQuality: storedConfig.preferredQuality,
      resolvedQuality: storedConfig.resolvedQuality ?? null,
      releaseId: storedConfig.releaseId ?? null,
    },
    status: row.status,
    attemptCount: row.attemptCount,
    externalTaskId: row.externalTaskId,
    firstAcceptedAt: row.firstAcceptedAt,
    lastAcceptedAt: row.lastAcceptedAt,
    manualRequestedAt: row.manualRequestedAt,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toDownloadRow(record: DownloadRecordRecord): typeof downloadRecords.$inferInsert {
  const { config, ...row } = record
  return {
    ...row,
    configJson: JSON.stringify(config),
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}
