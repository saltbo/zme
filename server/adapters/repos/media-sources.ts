import type { MediaSourceInput } from '@shared/types'
import { and, eq } from 'drizzle-orm'
import type { createDb } from '../../db/client'
import { type MediaSource, mediaSources } from '../../db/schema'
import type { ConnectorHealthPatch, MediaSourceRecord, MediaSourcesRepo } from '../../usecases/ports'

type Db = ReturnType<typeof createDb>

export function createMediaSourcesRepo(db: Db): MediaSourcesRepo {
  return {
    async list() {
      const rows = await db.select().from(mediaSources).orderBy(mediaSources.createdAt)
      return rows.map(toRecord)
    },

    async get(id) {
      const rows = await db.select().from(mediaSources).where(eq(mediaSources.id, id)).limit(1)
      return rows[0] ? toRecord(rows[0]) : null
    },

    async findEnabled(kind) {
      const rows = await db
        .select()
        .from(mediaSources)
        .where(and(eq(mediaSources.enabled, true), eq(mediaSources.kind, kind)))
        .limit(1)
      return rows[0] ? toRecord(rows[0]) : null
    },

    async create(input: MediaSourceInput) {
      const now = new Date().toISOString()
      const row: MediaSource = {
        id: crypto.randomUUID(),
        description: input.description || null,
        kind: input.kind,
        credentialsJson: JSON.stringify(input.credentials),
        optionsJson: JSON.stringify(input.options),
        enabled: input.enabled,
        healthStatus: 'unknown',
        healthMessage: null,
        healthCheckedAt: null,
        createdAt: now,
        updatedAt: now,
      }

      await db.insert(mediaSources).values(row)
      return toRecord(row)
    },

    async update(id, input: MediaSourceInput) {
      const updatedAt = new Date().toISOString()
      const rows = await db
        .update(mediaSources)
        .set({
          description: input.description || null,
          kind: input.kind,
          credentialsJson: JSON.stringify(input.credentials),
          optionsJson: JSON.stringify(input.options),
          enabled: input.enabled,
          updatedAt,
        })
        .where(eq(mediaSources.id, id))
        .returning()

      return rows[0] ? toRecord(rows[0]) : null
    },

    async delete(id) {
      const rows = await db.delete(mediaSources).where(eq(mediaSources.id, id)).returning({ id: mediaSources.id })
      return rows.length > 0
    },

    async setHealth(id, health: ConnectorHealthPatch) {
      const rows = await db
        .update(mediaSources)
        .set({
          healthStatus: health.status,
          healthMessage: health.message,
          healthCheckedAt: health.checkedAt,
          updatedAt: health.checkedAt,
        })
        .where(eq(mediaSources.id, id))
        .returning()
      return rows[0] ? toRecord(rows[0]) : null
    },
  }
}

function toRecord(row: MediaSource): MediaSourceRecord {
  return {
    id: row.id,
    description: row.description,
    kind: row.kind,
    credentials: JSON.parse(row.credentialsJson) as Record<string, string>,
    options: JSON.parse(row.optionsJson) as Record<string, string>,
    enabled: row.enabled,
    healthStatus: row.healthStatus,
    healthMessage: row.healthMessage,
    healthCheckedAt: row.healthCheckedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
