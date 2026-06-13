import type {
  LibraryMediaInput,
  LibraryMediaItem,
  LibraryMediaPage,
  LibraryPageInput,
  LibraryResourceInput,
  LibraryStateItem,
} from '@shared/types'
import { toLibraryResource } from '../domain/library-resource'
import { planSaveTransition, planWatchedTransition } from '../domain/library-state'
import type { Deps } from './deps'
import { getActiveTmdbSource } from './media-sources'
import type { ActiveMediaSource, LibraryRecord } from './ports'

export async function listLibrary(
  deps: Deps,
  userId: string,
  input: LibraryPageInput & { language?: string },
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
  const source = await getActiveTmdbSource(deps, input.language)

  const { rows, total } = await deps.libraryRepo.listPage(
    userId,
    { kind: input.kind, status: input.status },
    page,
    pageSize,
  )
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const items = await Promise.all(rows.map((row) => toLibraryMediaItem(deps, row, source)))
  return {
    items,
    page,
    pageSize,
    totalResults: total,
    totalPages,
  }
}

export async function listLibraryStates(deps: Deps, userId: string): Promise<LibraryStateItem[]> {
  const rows = await deps.libraryRepo.listAll(userId)
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
  deps: Deps,
  userId: string,
  input: LibraryMediaInput | LibraryResourceInput,
  savedAt?: string,
): Promise<LibraryRecord> {
  const now = new Date().toISOString()
  const resource = toLibraryResource(input)
  const key = resource.mediaKey
  const existing = await deps.libraryRepo.get(userId, key)
  const plan = planSaveTransition(existing, savedAt ?? now)

  if (plan.action === 'update') {
    const updated = await deps.libraryRepo.setStates(userId, key, {
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

  await deps.libraryRepo.insert(record)
  return record
}

export async function deleteLibraryState(deps: Deps, userId: string, input: LibraryResourceInput): Promise<boolean> {
  const resource = toLibraryResource(input)
  return deps.libraryRepo.delete(userId, resource.mediaKey)
}

export async function setWatchedState(
  deps: Deps,
  userId: string,
  input: LibraryMediaInput | LibraryResourceInput,
  watched: boolean,
  watchedAt?: string,
): Promise<LibraryRecord | null> {
  const now = new Date().toISOString()
  const resource = toLibraryResource(input)
  const key = resource.mediaKey
  const existing = await deps.libraryRepo.get(userId, key)
  const plan = planWatchedTransition(existing, watched, watchedAt ?? now)

  if (plan.action === 'none') return null

  if (plan.action === 'delete') {
    await deps.libraryRepo.delete(userId, key)
    return null
  }

  if (plan.action === 'update') {
    return deps.libraryRepo.setStates(userId, key, {
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

  await deps.libraryRepo.insert(record)
  return record
}

async function toLibraryMediaItem(
  deps: Deps,
  row: LibraryRecord,
  source: ActiveMediaSource,
): Promise<LibraryMediaItem> {
  if (row.kind !== 'movie' && row.kind !== 'tv') throw new Error(`Unsupported TMDB library kind: ${row.kind}`)
  if (!row.tmdbId) throw new Error(`Library item ${row.id} is missing tmdb_id.`)

  const item = await deps.mediaProvider.summary(source, row.kind, row.tmdbId)
  return {
    mediaKey: row.mediaKey,
    libraryItemId: row.id,
    savedAt: row.savedAt,
    watchedAt: row.watchedAt,
    updatedAt: row.updatedAt,
    ...item,
  }
}
