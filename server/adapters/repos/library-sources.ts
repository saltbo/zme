import type { createDb } from '@server/db/client'
import { type LibrarySource, librarySources } from '@server/db/schema'
import type { LibrarySourceRecord, LibrarySourcesRepo } from '@server/usecases/ports'
import type { LibrarySourceSyncResult } from '@shared/types'
import { and, eq } from 'drizzle-orm'

type Db = ReturnType<typeof createDb>

export function createLibrarySourcesRepo(db: Db): LibrarySourcesRepo {
  return {
    async list(userId) {
      const rows = await db
        .select()
        .from(librarySources)
        .where(eq(librarySources.userId, userId))
        .orderBy(librarySources.createdAt)
      return rows.map(toRecord)
    },

    async get(userId, source) {
      const rows = await db
        .select()
        .from(librarySources)
        .where(and(eq(librarySources.userId, userId), eq(librarySources.source, source)))
        .limit(1)
      return rows[0] ? toRecord(rows[0]) : null
    },

    async listEnabled() {
      const rows = await db.select().from(librarySources).where(eq(librarySources.enabled, true))
      return rows.map(toRecord)
    },

    async save(userId, source, input) {
      const now = new Date().toISOString()
      const existingRows = await db
        .select()
        .from(librarySources)
        .where(and(eq(librarySources.userId, userId), eq(librarySources.source, source)))
        .limit(1)
      const existing = existingRows[0]

      if (existing) {
        const rows = await db
          .update(librarySources)
          .set({
            profileId: input.profileId,
            enabled: input.enabled,
            lastError: null,
            updatedAt: now,
          })
          .where(and(eq(librarySources.userId, userId), eq(librarySources.source, source)))
          .returning()
        return toRecord(rows[0] ?? existing)
      }

      const row: LibrarySource = {
        id: crypto.randomUUID(),
        userId,
        source,
        profileId: input.profileId,
        enabled: input.enabled,
        lastSyncedAt: null,
        lastError: null,
        lastResultJson: null,
        createdAt: now,
        updatedAt: now,
      }

      await db.insert(librarySources).values(row)
      return toRecord(row)
    },

    async delete(userId, source) {
      const rows = await db
        .delete(librarySources)
        .where(and(eq(librarySources.userId, userId), eq(librarySources.source, source)))
        .returning({ id: librarySources.id })
      return rows.length > 0
    },

    async markSynced(id, result, error) {
      const now = new Date().toISOString()
      await db
        .update(librarySources)
        .set({
          lastSyncedAt: now,
          lastError: error,
          ...(result ? { lastResultJson: JSON.stringify(result) } : {}),
          updatedAt: now,
        })
        .where(eq(librarySources.id, id))
    },
  }
}

function toRecord(row: LibrarySource): LibrarySourceRecord {
  return {
    id: row.id,
    userId: row.userId,
    source: row.source,
    profileId: row.profileId,
    enabled: row.enabled,
    lastSyncedAt: row.lastSyncedAt,
    lastError: row.lastError,
    lastResult: row.lastResultJson ? (JSON.parse(row.lastResultJson) as LibrarySourceSyncResult) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
