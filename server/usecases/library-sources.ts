import type {
  LibrarySourceInput,
  LibrarySourceKind,
  LibrarySourceSummary,
  LibrarySourceSyncResult,
  MediaSearchItem,
} from '@shared/types'
import { chooseBestMatch } from '../domain/douban-match'
import type { Deps } from './deps'
import { saveLibraryState, setWatchedState } from './library'
import { getActiveTmdbSource } from './media-sources'
import type { ActiveMediaSource, ImportedLibraryEntry, LibrarySourceRecord } from './ports'

export async function listLibrarySources(deps: Deps, userId: string): Promise<LibrarySourceSummary[]> {
  const records = await deps.librarySourcesRepo.list(userId)
  return records.map(toSummary)
}

export async function saveLibrarySource(
  deps: Deps,
  userId: string,
  source: LibrarySourceKind,
  input: LibrarySourceInput,
): Promise<LibrarySourceSummary> {
  const record = await deps.librarySourcesRepo.save(userId, source, {
    profileId: normalizeProfileId(input.profileId),
    enabled: input.enabled,
  })
  return toSummary(record)
}

export async function deleteLibrarySource(deps: Deps, userId: string, source: LibrarySourceKind): Promise<boolean> {
  return deps.librarySourcesRepo.delete(userId, source)
}

export async function syncLibrarySource(
  deps: Deps,
  userId: string,
  source: LibrarySourceKind,
): Promise<LibrarySourceSyncResult> {
  const record = await deps.librarySourcesRepo.get(userId, source)
  if (!record) throw new Error('Library source is not configured.')
  const tmdb = await getActiveTmdbSource(deps)
  return syncLibrarySourceRecord(deps, record, tmdb)
}

export async function syncEnabledLibrarySources(deps: Deps): Promise<void> {
  const records = await deps.librarySourcesRepo.listEnabled()
  if (records.length === 0) return

  const tmdb = await getActiveTmdbSource(deps)
  for (const record of records) {
    await syncLibrarySourceRecord(deps, record, tmdb).catch(() => undefined)
  }
}

async function syncLibrarySourceRecord(
  deps: Deps,
  source: LibrarySourceRecord,
  tmdb: ActiveMediaSource,
): Promise<LibrarySourceSyncResult> {
  try {
    const entries = await deps.libraryImporters[source.source].fetchEntries(source.profileId)
    const result = await importEntries(deps, source.userId, entries, tmdb)
    await deps.librarySourcesRepo.markSynced(source.id, result, null)
    return result
  } catch (error) {
    await deps.librarySourcesRepo.markSynced(
      source.id,
      null,
      error instanceof Error ? error.message : 'Library source sync failed.',
    )
    throw error
  }
}

async function importEntries(
  deps: Deps,
  userId: string,
  entries: ImportedLibraryEntry[],
  tmdb: ActiveMediaSource,
): Promise<LibrarySourceSyncResult> {
  const result: LibrarySourceSyncResult = {
    scanned: entries.length,
    imported: 0,
    saved: 0,
    watched: 0,
    unmatched: 0,
  }

  const wishEntries = entries.filter((entry) => entry.status === 'wish')
  const watchedEntries = entries.filter((entry) => entry.status === 'collect')

  for (const entry of [...wishEntries, ...watchedEntries]) {
    const item = await matchImportedEntry(deps, entry, tmdb)
    if (!item) {
      result.unmatched += 1
      continue
    }

    if (entry.status === 'collect') {
      await setWatchedState(deps, userId, item, true, entry.markedAt ?? undefined)
      result.watched += 1
    } else {
      await saveLibraryState(deps, userId, item, entry.markedAt ?? undefined)
      result.saved += 1
    }
    result.imported += 1
  }

  return result
}

async function matchImportedEntry(
  deps: Deps,
  entry: ImportedLibraryEntry,
  tmdb: ActiveMediaSource,
): Promise<MediaSearchItem | null> {
  const queries = [entry.title, ...entry.aliases].filter(Boolean)
  for (const query of queries) {
    const candidates = await deps.mediaProvider.search(tmdb, query)
    const match = chooseBestMatch(entry, query, candidates)
    if (match) return match
  }
  return null
}

function toSummary(record: LibrarySourceRecord): LibrarySourceSummary {
  return {
    id: record.id,
    source: record.source,
    profileId: record.profileId,
    enabled: record.enabled,
    lastSyncedAt: record.lastSyncedAt,
    lastError: record.lastError,
    lastResult: record.lastResult,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function normalizeProfileId(value: string): string {
  const trimmed = value.trim()
  const match = trimmed.match(/douban\.com\/people\/([^/?#]+)/)
  return decodeURIComponent(match?.[1] ?? trimmed)
}
