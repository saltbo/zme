import type {
  LibraryMediaInput,
  LibraryMediaItem,
  LibraryMediaPage,
  LibraryPageInput,
  LibraryResourceInput,
  LibraryStateItem,
} from '@shared/types'
import { getMediaSummary } from '../adapters/providers/tmdb'
import { createLibraryRepo } from '../adapters/repos/library'
import type { createDb } from '../db/client'
import { toLibraryResource } from '../domain/library-resource'
import { planSaveTransition, planWatchedTransition } from '../domain/library-state'
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
  const resource = toLibraryResource(input)
  const key = resource.mediaKey
  const existing = await repo.get(userId, key)
  const plan = planSaveTransition(existing, savedAt ?? now)

  if (plan.action === 'update') {
    const updated = await repo.setStates(userId, key, {
      savedAt: plan.savedAt,
      watchedAt: plan.watchedAt,
      updatedAt: now,
    })
    if (!updated && !existing) throw new Error(`Library item disappeared during update: ${key}`)
    return updated ?? (existing as LibraryRecord)
  }

  const record: LibraryRecord = {
    id: crypto.randomUUID(),
    userId,
    mediaKey: key,
    kind: resource.kind,
    tmdbId: resource.tmdbId,
    savedAt: plan.savedAt,
    watchedAt: plan.watchedAt,
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
  const resource = toLibraryResource(input)
  const key = resource.mediaKey
  const existing = await repo.get(userId, key)
  const plan = planWatchedTransition(existing, watched, watchedAt ?? now)

  if (plan.action === 'none') return null

  if (plan.action === 'delete') {
    await repo.delete(userId, key)
    return null
  }

  if (plan.action === 'update') {
    return repo.setStates(userId, key, {
      savedAt: plan.savedAt,
      watchedAt: plan.watchedAt,
      updatedAt: now,
    })
  }

  const record: LibraryRecord = {
    id: crypto.randomUUID(),
    userId,
    mediaKey: key,
    kind: resource.kind,
    tmdbId: resource.tmdbId,
    savedAt: plan.savedAt,
    watchedAt: plan.watchedAt,
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
