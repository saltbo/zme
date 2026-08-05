import type { createDb } from '@server/db/client'
import { type Indexer, indexers } from '@server/db/schema'
import type { ConnectorHealthPatch, IndexerRecord, IndexersRepo } from '@server/usecases/ports'
import type { IndexerInput } from '@shared/types'
import { and, eq, isNull, lt, or } from 'drizzle-orm'

type Db = ReturnType<typeof createDb>

export function createIndexersRepo(db: Db): IndexersRepo {
  return {
    async list() {
      const rows = await db.select().from(indexers).orderBy(indexers.createdAt)
      return rows.map(toRecord)
    },

    async get(id) {
      const rows = await db.select().from(indexers).where(eq(indexers.id, id)).limit(1)
      return rows[0] ? toRecord(rows[0]) : null
    },

    async listEnabled() {
      const rows = await db.select().from(indexers).where(eq(indexers.enabled, true))
      return rows.map(toRecord)
    },

    async create(input: IndexerInput) {
      const now = new Date().toISOString()
      const row: Indexer = {
        id: crypto.randomUUID(),
        description: input.description || null,
        kind: input.kind,
        endpoint: input.endpoint,
        credentialsJson: JSON.stringify(input.credentials),
        optionsJson: JSON.stringify(input.options),
        enabled: input.enabled,
        healthStatus: 'unknown',
        healthMessage: null,
        healthCheckedAt: null,
        createdAt: now,
        updatedAt: now,
      }

      await db.insert(indexers).values(row)
      return toRecord(row)
    },

    async update(id, input: IndexerInput, expectedUpdatedAt) {
      const updatedAt = nextUpdatedAt(expectedUpdatedAt)
      const rows = await db
        .update(indexers)
        .set({
          description: input.description || null,
          kind: input.kind,
          endpoint: input.endpoint,
          credentialsJson: JSON.stringify(input.credentials),
          optionsJson: JSON.stringify(input.options),
          enabled: input.enabled,
          updatedAt,
        })
        .where(and(eq(indexers.id, id), eq(indexers.updatedAt, expectedUpdatedAt)))
        .returning()

      return rows[0] ? toRecord(rows[0]) : null
    },

    async delete(id, expectedUpdatedAt) {
      const rows = await db
        .delete(indexers)
        .where(and(eq(indexers.id, id), eq(indexers.updatedAt, expectedUpdatedAt)))
        .returning({ id: indexers.id })
      return rows.length > 0
    },

    async setHealth(id, health: ConnectorHealthPatch) {
      const rows = await db
        .update(indexers)
        .set({
          healthStatus: health.status,
          healthMessage: health.message,
          healthCheckedAt: health.checkedAt,
        })
        .where(
          and(
            eq(indexers.id, id),
            or(isNull(indexers.healthCheckedAt), lt(indexers.healthCheckedAt, health.checkedAt)),
          ),
        )
        .returning()
      if (rows[0]) return toRecord(rows[0])
      const current = await db.select().from(indexers).where(eq(indexers.id, id)).limit(1)
      return current[0] ? toRecord(current[0]) : null
    },
  }
}

function nextUpdatedAt(expectedUpdatedAt: string) {
  return new Date(Math.max(Date.now(), Date.parse(expectedUpdatedAt) + 1)).toISOString()
}

function toRecord(row: Indexer): IndexerRecord {
  return {
    id: row.id,
    description: row.description,
    kind: row.kind,
    config: {
      endpoint: row.endpoint,
      credentials: JSON.parse(row.credentialsJson) as Record<string, string>,
      options: JSON.parse(row.optionsJson) as Record<string, string>,
    },
    enabled: row.enabled,
    healthStatus: row.healthStatus,
    healthMessage: row.healthMessage,
    healthCheckedAt: row.healthCheckedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
