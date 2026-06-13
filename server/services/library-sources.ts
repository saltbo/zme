import type {
  LibrarySourceInput,
  LibrarySourceKind,
  LibrarySourceSummary,
  LibrarySourceSyncResult,
  MediaSearchItem,
} from '@shared/types'
import { type DoubanMediaEntry, fetchDoubanProfileEntries } from '../adapters/providers/douban'
import { searchMedia } from '../adapters/providers/tmdb'
import { createLibrarySourcesRepo } from '../adapters/repos/library-sources'
import type { createDb } from '../db/client'
import type { LibrarySourceRecord } from '../usecases/ports'
import { saveLibraryState, setWatchedState } from './library'
import type { ActiveTmdbSource } from './media-sources'

type Db = ReturnType<typeof createDb>

const ACCEPTED_MATCH_SCORE = 4

export async function listLibrarySources(db: Db, userId: string): Promise<LibrarySourceSummary[]> {
  const records = await createLibrarySourcesRepo(db).list(userId)
  return records.map(toSummary)
}

export async function saveLibrarySource(
  db: Db,
  userId: string,
  source: LibrarySourceKind,
  input: LibrarySourceInput,
): Promise<LibrarySourceSummary> {
  const record = await createLibrarySourcesRepo(db).save(userId, source, {
    profileId: normalizeProfileId(input.profileId),
    enabled: input.enabled,
  })
  return toSummary(record)
}

export async function deleteLibrarySource(db: Db, userId: string, source: LibrarySourceKind): Promise<boolean> {
  return createLibrarySourcesRepo(db).delete(userId, source)
}

export async function syncLibrarySource(
  db: Db,
  userId: string,
  source: LibrarySourceKind,
  tmdb: ActiveTmdbSource,
): Promise<LibrarySourceSyncResult> {
  const record = await createLibrarySourcesRepo(db).get(userId, source)
  if (!record) throw new Error('Library source is not configured.')
  return syncLibrarySourceRecord(db, record, tmdb)
}

export async function syncEnabledLibrarySources(db: Db, tmdb: ActiveTmdbSource): Promise<void> {
  const records = await createLibrarySourcesRepo(db).listEnabled()
  for (const record of records) {
    await syncLibrarySourceRecord(db, record, tmdb).catch(() => undefined)
  }
}

async function syncLibrarySourceRecord(
  db: Db,
  source: LibrarySourceRecord,
  tmdb: ActiveTmdbSource,
): Promise<LibrarySourceSyncResult> {
  const repo = createLibrarySourcesRepo(db)
  try {
    const entries = await fetchEntries(source)
    const result = await importEntries(db, source.userId, entries, tmdb)
    await repo.markSynced(source.id, result, null)
    return result
  } catch (error) {
    await repo.markSynced(source.id, null, error instanceof Error ? error.message : 'Library source sync failed.')
    throw error
  }
}

async function fetchEntries(source: LibrarySourceRecord): Promise<DoubanMediaEntry[]> {
  if (source.source === 'douban') {
    return fetchDoubanProfileEntries(source.profileId)
  }

  throw new Error(`Unsupported library source: ${source.source}`)
}

async function importEntries(
  db: Db,
  userId: string,
  entries: DoubanMediaEntry[],
  tmdb: ActiveTmdbSource,
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
    const item = await matchDoubanEntry(entry, tmdb)
    if (!item) {
      result.unmatched += 1
      continue
    }

    if (entry.status === 'collect') {
      await setWatchedState(db, userId, item, true, entry.markedAt ?? undefined)
      result.watched += 1
    } else {
      await saveLibraryState(db, userId, item, entry.markedAt ?? undefined)
      result.saved += 1
    }
    result.imported += 1
  }

  return result
}

async function matchDoubanEntry(entry: DoubanMediaEntry, tmdb: ActiveTmdbSource): Promise<MediaSearchItem | null> {
  const queries = [entry.title, ...entry.aliases].filter(Boolean)
  for (const query of queries) {
    const candidates = await searchMedia(tmdb.apiKey, query, tmdb.language)
    const match = chooseBestMatch(entry, query, candidates)
    if (match) return match
  }
  return null
}

function chooseBestMatch(
  entry: DoubanMediaEntry,
  query: string,
  candidates: MediaSearchItem[],
): MediaSearchItem | null {
  let best: { item: MediaSearchItem; score: number } | null = null
  for (const item of candidates.slice(0, 8)) {
    const score = scoreCandidate(entry, query, item)
    if (!best || score > best.score) best = { item, score }
  }
  return best && best.score >= ACCEPTED_MATCH_SCORE ? best.item : null
}

function scoreCandidate(entry: DoubanMediaEntry, query: string, item: MediaSearchItem): number {
  const queryText = normalizeTitle(query)
  const sourceTitles = [entry.title, ...entry.aliases].map(normalizeTitle).filter(Boolean)
  const itemTitles = [item.title, item.originalTitle].map(normalizeTitle).filter(Boolean)
  let score = 0

  if (item.releaseYear && entry.year && item.releaseYear === entry.year) score += 2
  if (itemTitles.some((title) => title === queryText)) score += 4
  if (itemTitles.some((title) => sourceTitles.includes(title))) score += 4
  if (itemTitles.some((title) => title.includes(queryText) || queryText.includes(title))) score += 2
  if (item.rating && item.rating >= 5) score += 1

  return score
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[第\s]*(一|二|三|四|五|六|七|八|九|十|\d+)[季部]$/u, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '')
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
