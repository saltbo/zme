import type { createDb } from '@server/db/client'
import { type Downloader, downloaders } from '@server/db/schema'
import type { ConnectorHealthPatch, DownloaderRecord, DownloadersRepo } from '@server/usecases/ports'
import type { DownloaderInput } from '@shared/types'
import { and, eq } from 'drizzle-orm'

type Db = ReturnType<typeof createDb>

export function createDownloadersRepo(db: Db): DownloadersRepo {
  return {
    async list(userId) {
      const rows = await db
        .select()
        .from(downloaders)
        .where(eq(downloaders.userId, userId))
        .orderBy(downloaders.createdAt)
      return rows.map(toRecord)
    },

    async get(userId, id) {
      const rows = await db
        .select()
        .from(downloaders)
        .where(and(eq(downloaders.id, id), eq(downloaders.userId, userId)))
        .limit(1)
      return rows[0] ? toRecord(rows[0]) : null
    },

    async getEnabled(userId, id) {
      const rows = await db
        .select()
        .from(downloaders)
        .where(and(eq(downloaders.id, id), eq(downloaders.userId, userId), eq(downloaders.enabled, true)))
        .limit(1)
      return rows[0] ? toRecord(rows[0]) : null
    },

    async listEnabled(userId) {
      const rows = await db
        .select()
        .from(downloaders)
        .where(and(eq(downloaders.userId, userId), eq(downloaders.enabled, true)))
      return rows.map(toRecord)
    },

    async create(userId, input) {
      const now = new Date().toISOString()
      const row: Downloader = {
        id: crypto.randomUUID(),
        userId,
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

      await db.insert(downloaders).values(row)
      return toRecord(row)
    },

    async update(userId, id, input: DownloaderInput) {
      const updatedAt = new Date().toISOString()
      const rows = await db
        .update(downloaders)
        .set({
          description: input.description || null,
          kind: input.kind,
          endpoint: input.endpoint,
          credentialsJson: JSON.stringify(input.credentials),
          optionsJson: JSON.stringify(input.options),
          enabled: input.enabled,
          updatedAt,
        })
        .where(and(eq(downloaders.id, id), eq(downloaders.userId, userId)))
        .returning()

      return rows[0] ? toRecord(rows[0]) : null
    },

    async delete(userId, id) {
      const rows = await db
        .delete(downloaders)
        .where(and(eq(downloaders.id, id), eq(downloaders.userId, userId)))
        .returning({ id: downloaders.id })
      return rows.length > 0
    },

    async setHealth(userId, id, health: ConnectorHealthPatch) {
      const rows = await db
        .update(downloaders)
        .set({
          healthStatus: health.status,
          healthMessage: health.message,
          healthCheckedAt: health.checkedAt,
          updatedAt: health.checkedAt,
        })
        .where(and(eq(downloaders.id, id), eq(downloaders.userId, userId)))
        .returning()
      return rows[0] ? toRecord(rows[0]) : null
    },
  }
}

function toRecord(row: Downloader): DownloaderRecord {
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
