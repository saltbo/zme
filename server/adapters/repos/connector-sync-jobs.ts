import type { createDb } from '@server/db/client'
import { connectorSyncJobs } from '@server/db/schema'
import type { ConnectorSyncJobRecord, ConnectorSyncJobsRepo } from '@server/usecases/ports'
import type { ConnectorSyncResult } from '@shared/types'
import { and, asc, eq, gte, isNull, lt, or, sql } from 'drizzle-orm'

type Db = ReturnType<typeof createDb>

export function createConnectorSyncJobsRepo(db: Db): ConnectorSyncJobsRepo {
  return {
    async findByIdempotency(userId, key) {
      const rows = await db
        .select()
        .from(connectorSyncJobs)
        .where(and(eq(connectorSyncJobs.userId, userId), eq(connectorSyncJobs.idempotencyKey, key)))
        .limit(1)
      return rows[0] ? toRecord(rows[0]) : null
    },

    async listQueued(limit) {
      return (
        await db
          .select()
          .from(connectorSyncJobs)
          .where(eq(connectorSyncJobs.status, 'queued'))
          .orderBy(asc(connectorSyncJobs.createdAt))
          .limit(limit)
      ).map(toRecord)
    },

    async create(record) {
      const { result, ...values } = record
      const rows = await db
        .insert(connectorSyncJobs)
        .values({ ...values, resultJson: result ? JSON.stringify(result) : null })
        .onConflictDoNothing()
        .returning({ id: connectorSyncJobs.id })
      return rows.length === 1
    },

    async get(userId, id) {
      const rows = await db
        .select()
        .from(connectorSyncJobs)
        .where(and(eq(connectorSyncJobs.userId, userId), eq(connectorSyncJobs.id, id)))
        .limit(1)
      return rows[0] ? toRecord(rows[0]) : null
    },

    async claim(id, leaseOwner, now, leaseExpiresAt) {
      const rows = await db
        .update(connectorSyncJobs)
        .set({
          status: 'running',
          startedAt: sql`COALESCE(${connectorSyncJobs.startedAt}, ${now})`,
          leaseOwner,
          leaseExpiresAt,
        })
        .where(
          and(
            eq(connectorSyncJobs.id, id),
            or(
              eq(connectorSyncJobs.status, 'queued'),
              and(
                eq(connectorSyncJobs.status, 'running'),
                or(isNull(connectorSyncJobs.leaseExpiresAt), lt(connectorSyncJobs.leaseExpiresAt, now)),
              ),
            ),
          ),
        )
        .returning({ id: connectorSyncJobs.id })
      return rows.length > 0
    },

    async renew(id, leaseOwner, now, leaseExpiresAt) {
      const rows = await db
        .update(connectorSyncJobs)
        .set({ leaseExpiresAt })
        .where(
          and(
            eq(connectorSyncJobs.id, id),
            eq(connectorSyncJobs.status, 'running'),
            eq(connectorSyncJobs.leaseOwner, leaseOwner),
            gte(connectorSyncJobs.leaseExpiresAt, now),
          ),
        )
        .returning({ id: connectorSyncJobs.id })
      return rows.length === 1
    },

    async complete(id, leaseOwner, result, completedAt) {
      const rows = await db
        .update(connectorSyncJobs)
        .set({
          status: 'completed',
          resultJson: JSON.stringify(result),
          error: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt,
        })
        .where(
          and(
            eq(connectorSyncJobs.id, id),
            eq(connectorSyncJobs.status, 'running'),
            eq(connectorSyncJobs.leaseOwner, leaseOwner),
          ),
        )
        .returning({ id: connectorSyncJobs.id })
      return rows.length === 1
    },

    async fail(id, leaseOwner, error, completedAt) {
      const rows = await db
        .update(connectorSyncJobs)
        .set({ status: 'failed', error, leaseOwner: null, leaseExpiresAt: null, completedAt })
        .where(
          and(
            eq(connectorSyncJobs.id, id),
            eq(connectorSyncJobs.status, 'running'),
            eq(connectorSyncJobs.leaseOwner, leaseOwner),
          ),
        )
        .returning({ id: connectorSyncJobs.id })
      return rows.length === 1
    },
  }
}

function toRecord(row: typeof connectorSyncJobs.$inferSelect): ConnectorSyncJobRecord {
  return {
    id: row.id,
    userId: row.userId,
    connectorId: row.connectorId,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    status: row.status,
    result: row.resultJson ? (JSON.parse(row.resultJson) as ConnectorSyncResult) : null,
    error: row.error,
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: row.leaseExpiresAt,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  }
}
