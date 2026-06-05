import { buildTmdbMediaKey, getMediaKeyLibraryKind, parseTmdbMediaKey } from '@shared/media-key'
import type {
  LibraryFilterKind,
  LibraryFilterStatus,
  LibraryMediaInput,
  LibraryMediaItem,
  LibraryMediaPage,
  LibraryPageInput,
  LibraryResourceInput,
  LibraryStateItem,
  MediaKind,
} from '@shared/types'
import { and, count, desc, eq, inArray, isNotNull, isNull, type SQL } from 'drizzle-orm'
import type { createDb } from '../db/client'
import { type LibraryItem, library } from '../db/schema'
import type { ActiveTmdbSource } from './media-sources'
import { getMediaSummary } from './tmdb'

type Db = ReturnType<typeof createDb>

export async function listLibrary(
  db: Db,
  userId: string,
  tmdb: ActiveTmdbSource | null,
  input: LibraryPageInput,
): Promise<LibraryMediaPage> {
  if (input.kind === 'music' || input.kind === 'book') {
    return {
      items: [],
      page: Math.max(1, input.page),
      pageSize: Math.min(60, Math.max(1, input.pageSize)),
      totalResults: 0,
      totalPages: 1,
    }
  }

  const page = Math.max(1, input.page)
  const pageSize = Math.min(60, Math.max(1, input.pageSize))
  if (!tmdb) throw new Error('TMDB source is required for movie and tv library items.')

  const where = libraryWhere(userId, input.kind, input.status)
  const totalRows = await db.select({ value: count() }).from(library).where(where)
  const totalResults = totalRows[0]?.value ?? 0
  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize))
  const rows = await db
    .select()
    .from(library)
    .where(where)
    .orderBy(desc(library.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
  const items = await Promise.all(rows.map((row) => toLibraryMediaItem(row, tmdb)))
  return {
    items,
    page,
    pageSize,
    totalResults,
    totalPages,
  }
}

export async function listLibraryStates(db: Db, userId: string): Promise<LibraryStateItem[]> {
  const rows = await db.select().from(library).where(eq(library.userId, userId))
  return rows.map((row) => ({
    mediaKey: row.mediaKey,
    id: row.tmdbId,
    kind: row.kind,
    savedAt: row.savedAt,
    watchedAt: row.watchedAt,
    updatedAt: row.updatedAt,
  }))
}

export async function saveLibraryState(
  db: Db,
  userId: string,
  input: LibraryMediaInput | LibraryResourceInput,
  savedAt?: string,
): Promise<LibraryItem> {
  const now = new Date().toISOString()
  const nextSavedAt = savedAt ?? now
  const resource = toLibraryResource(input)
  const key = resource.mediaKey
  const existing = await getLibraryRow(db, userId, key)
  if (existing) {
    const rows = await db
      .update(library)
      .set({
        savedAt: existing.savedAt ?? nextSavedAt,
        updatedAt: now,
      })
      .where(and(eq(library.userId, userId), eq(library.mediaKey, key)))
      .returning()

    return rows[0] ?? existing
  }

  const row: LibraryItem = {
    id: crypto.randomUUID(),
    userId,
    mediaKey: key,
    kind: resource.kind,
    tmdbId: resource.tmdbId,
    savedAt: nextSavedAt,
    watchedAt: null,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(library).values(row)
  return row
}

export async function deleteLibraryState(db: Db, userId: string, input: LibraryResourceInput): Promise<boolean> {
  const resource = toLibraryResource(input)
  const rows = await db
    .delete(library)
    .where(and(eq(library.userId, userId), eq(library.mediaKey, resource.mediaKey)))
    .returning({
      id: library.id,
    })
  return rows.length > 0
}

export async function setWatchedState(
  db: Db,
  userId: string,
  input: LibraryMediaInput | LibraryResourceInput,
  watched: boolean,
  watchedAt?: string,
): Promise<LibraryItem | null> {
  const now = new Date().toISOString()
  const nextWatchedAt = watchedAt ?? now
  const resource = toLibraryResource(input)
  const key = resource.mediaKey
  const existing = await getLibraryRow(db, userId, key)

  if (existing) {
    if (!watched && !existing.savedAt) {
      await db.delete(library).where(and(eq(library.userId, userId), eq(library.mediaKey, key)))
      return null
    }

    const rows = await db
      .update(library)
      .set({
        savedAt: watched ? (existing.savedAt ?? nextWatchedAt) : existing.savedAt,
        watchedAt: watched ? (existing.watchedAt ?? nextWatchedAt) : null,
        updatedAt: now,
      })
      .where(and(eq(library.userId, userId), eq(library.mediaKey, key)))
      .returning()

    return rows[0] ?? null
  }

  if (!watched) return null

  const row: LibraryItem = {
    id: crypto.randomUUID(),
    userId,
    mediaKey: key,
    kind: resource.kind,
    tmdbId: resource.tmdbId,
    savedAt: nextWatchedAt,
    watchedAt: nextWatchedAt,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(library).values(row)
  return row
}

async function getLibraryRow(db: Db, userId: string, key: string): Promise<LibraryItem | null> {
  const rows = await db
    .select()
    .from(library)
    .where(and(eq(library.userId, userId), eq(library.mediaKey, key)))
    .limit(1)
  return rows[0] ?? null
}

async function toLibraryMediaItem(row: LibraryItem, tmdb: ActiveTmdbSource): Promise<LibraryMediaItem> {
  if (row.kind !== 'movie' && row.kind !== 'tv') throw new Error(`Unsupported TMDB library kind: ${row.kind}`)
  if (!row.tmdbId) throw new Error(`Library item ${row.id} is missing tmdb_id.`)

  const item = await getMediaSummary(tmdb.apiKey, row.kind, row.tmdbId, tmdb.language)
  return {
    mediaKey: row.mediaKey,
    libraryItemId: row.id,
    savedAt: row.savedAt,
    watchedAt: row.watchedAt,
    updatedAt: row.updatedAt,
    ...item,
  }
}

function toLibraryResource(input: LibraryMediaInput | LibraryResourceInput): {
  mediaKey: string
  kind: LibraryItem['kind']
  tmdbId: number | null
} {
  if ('mediaKey' in input) {
    const kind = getMediaKeyLibraryKind(input.mediaKey)
    if (!kind) throw new Error(`Invalid library media key: ${input.mediaKey}`)
    if (kind !== input.kind) throw new Error(`Library kind does not match media key: ${input.mediaKey}`)

    const tmdb = parseTmdbMediaKey(input.mediaKey)
    return {
      mediaKey: input.mediaKey,
      kind: input.kind,
      tmdbId: tmdb?.kind === input.kind ? tmdb.tmdbId : null,
    }
  }

  return toTmdbLibraryResource(input)
}

function toTmdbLibraryResource(input: LibraryMediaInput): {
  mediaKey: string
  kind: MediaKind
  tmdbId: number
} {
  return {
    mediaKey: buildTmdbMediaKey(input.kind, input.id),
    kind: input.kind,
    tmdbId: input.id,
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
