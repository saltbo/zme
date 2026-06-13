import { buildTmdbMediaKey, getMediaKeyLibraryKind, parseTmdbMediaKey } from '@shared/media-key'
import type {
  LibraryMediaInput,
  LibraryMediaItem,
  LibraryMediaPage,
  LibraryPageInput,
  LibraryResourceInput,
  LibraryStateItem,
  MediaKind,
} from '@shared/types'
import { getMediaSummary } from '../adapters/providers/tmdb'
import { createLibraryRepo } from '../adapters/repos/library'
import type { createDb } from '../db/client'
import type { LibraryRecord } from '../usecases/ports'
import type { ActiveTmdbSource } from './media-sources'

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

  const repo = createLibraryRepo(db)
  const { rows, total } = await repo.listPage(userId, { kind: input.kind, status: input.status }, page, pageSize)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const items = await Promise.all(rows.map((row) => toLibraryMediaItem(row, tmdb)))
  return {
    items,
    page,
    pageSize,
    totalResults: total,
    totalPages,
  }
}

export async function listLibraryStates(db: Db, userId: string): Promise<LibraryStateItem[]> {
  const rows = await createLibraryRepo(db).listAll(userId)
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
): Promise<LibraryRecord> {
  const repo = createLibraryRepo(db)
  const now = new Date().toISOString()
  const nextSavedAt = savedAt ?? now
  const resource = toLibraryResource(input)
  const key = resource.mediaKey
  const existing = await repo.get(userId, key)
  if (existing) {
    const updated = await repo.setStates(userId, key, {
      savedAt: existing.savedAt ?? nextSavedAt,
      watchedAt: existing.watchedAt,
      updatedAt: now,
    })
    return updated ?? existing
  }

  const record: LibraryRecord = {
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

  await repo.insert(record)
  return record
}

export async function deleteLibraryState(db: Db, userId: string, input: LibraryResourceInput): Promise<boolean> {
  const resource = toLibraryResource(input)
  return createLibraryRepo(db).delete(userId, resource.mediaKey)
}

export async function setWatchedState(
  db: Db,
  userId: string,
  input: LibraryMediaInput | LibraryResourceInput,
  watched: boolean,
  watchedAt?: string,
): Promise<LibraryRecord | null> {
  const repo = createLibraryRepo(db)
  const now = new Date().toISOString()
  const nextWatchedAt = watchedAt ?? now
  const resource = toLibraryResource(input)
  const key = resource.mediaKey
  const existing = await repo.get(userId, key)

  if (existing) {
    if (!watched && !existing.savedAt) {
      await repo.delete(userId, key)
      return null
    }

    return repo.setStates(userId, key, {
      savedAt: watched ? (existing.savedAt ?? nextWatchedAt) : existing.savedAt,
      watchedAt: watched ? (existing.watchedAt ?? nextWatchedAt) : null,
      updatedAt: now,
    })
  }

  if (!watched) return null

  const record: LibraryRecord = {
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

  await repo.insert(record)
  return record
}

async function toLibraryMediaItem(row: LibraryRecord, tmdb: ActiveTmdbSource): Promise<LibraryMediaItem> {
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
  kind: LibraryRecord['kind']
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
