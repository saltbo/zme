import type { LibraryFilterKind, LibraryFilterStatus } from '@shared/types'
import { and, count, desc, eq, inArray, isNotNull, isNull, type SQL } from 'drizzle-orm'
import type { createDb } from '../../db/client'
import { type LibraryItem, library } from '../../db/schema'
import type { LibraryRecord, LibraryRepo } from '../../usecases/ports'

type Db = ReturnType<typeof createDb>

export function createLibraryRepo(db: Db): LibraryRepo {
  return {
    async get(userId, mediaKey) {
      const rows = await db
        .select()
        .from(library)
        .where(and(eq(library.userId, userId), eq(library.mediaKey, mediaKey)))
        .limit(1)
      return rows[0] ?? null
    },

    async listAll(userId) {
      return db.select().from(library).where(eq(library.userId, userId))
    },

    async listPage(userId, filter, page, pageSize) {
      const where = libraryWhere(userId, filter.kind, filter.status)
      const totalRows = await db.select({ value: count() }).from(library).where(where)
      const total = totalRows[0]?.value ?? 0
      const rows = await db
        .select()
        .from(library)
        .where(where)
        .orderBy(desc(library.updatedAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize)
      return { rows, total }
    },

    async insert(record: LibraryRecord) {
      await db.insert(library).values(record as LibraryItem)
    },

    async setStates(userId, mediaKey, patch) {
      const rows = await db
        .update(library)
        .set(patch)
        .where(and(eq(library.userId, userId), eq(library.mediaKey, mediaKey)))
        .returning()
      return rows[0] ?? null
    },

    async delete(userId, mediaKey) {
      const rows = await db
        .delete(library)
        .where(and(eq(library.userId, userId), eq(library.mediaKey, mediaKey)))
        .returning({ id: library.id })
      return rows.length > 0
    },
  }
}

function libraryWhere(userId: string, kind?: LibraryFilterKind, status?: LibraryFilterStatus): SQL {
  const filters: SQL[] = [eq(library.userId, userId)]

  if (kind === 'movie' || kind === 'tv') {
    filters.push(eq(library.kind, kind))
  } else {
    filters.push(inArray(library.kind, ['movie', 'tv']))
  }

  if (status === 'watched') {
    filters.push(isNotNull(library.watchedAt))
  } else if (status === 'unwatched') {
    filters.push(isNotNull(library.savedAt), isNull(library.watchedAt))
  }

  return and(...filters) as SQL
}
