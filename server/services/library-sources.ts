import type {
  LibrarySourceInput,
  LibrarySourceKind,
  LibrarySourceSummary,
  LibrarySourceSyncResult,
  MediaSearchItem,
} from '@shared/types'
import { and, eq } from 'drizzle-orm'
import type { createDb } from '../db/client'
import { type LibrarySource, librarySources } from '../db/schema'
import { type DoubanMediaEntry, fetchDoubanProfileEntries } from '../adapters/providers/douban'
import { saveLibraryState, setWatchedState } from './library'
import type { ActiveTmdbSource } from './media-sources'
import { searchMedia } from '../adapters/providers/tmdb'

type Db = ReturnType<typeof createDb>

const ACCEPTED_MATCH_SCORE = 4

export async function listLibrarySources(db: Db, userId: string): Promise<LibrarySourceSummary[]> {
  const rows = await db
    .select()
    .from(librarySources)
    .where(eq(librarySources.userId, userId))
    .orderBy(librarySources.createdAt)
  return rows.map(toSummary)
}

export async function saveLibrarySource(
  db: Db,
  userId: string,
  source: LibrarySourceKind,
  input: LibrarySourceInput,
): Promise<LibrarySourceSummary> {
  const now = new Date().toISOString()
  const profileId = normalizeProfileId(input.profileId)
  const existing = await getLibrarySourceRow(db, userId, source)

  if (existing) {
    const rows = await db
      .update(librarySources)
      .set({
        profileId,
        enabled: input.enabled,
        lastError: null,
        updatedAt: now,
      })
      .where(and(eq(librarySources.userId, userId), eq(librarySources.source, source)))
      .returning()
    return toSummary(rows[0] ?? existing)
  }

  const row: LibrarySource = {
    id: crypto.randomUUID(),
    userId,
    source,
    profileId,
    enabled: input.enabled,
    lastSyncedAt: null,
    lastError: null,
    lastResultJson: null,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(librarySources).values(row)
  return toSummary(row)
}

export async function deleteLibrarySource(db: Db, userId: string, source: LibrarySourceKind): Promise<boolean> {
  const rows = await db
    .delete(librarySources)
    .where(and(eq(librarySources.userId, userId), eq(librarySources.source, source)))
    .returning({ id: librarySources.id })
  return rows.length > 0
}

export async function syncLibrarySource(
  db: Db,
  userId: string,
  source: LibrarySourceKind,
  tmdb: ActiveTmdbSource,
): Promise<LibrarySourceSyncResult> {
  const row = await getLibrarySourceRow(db, userId, source)
  if (!row) throw new Error('Library source is not configured.')
  return syncLibrarySourceRow(db, row, tmdb)
}

export async function syncEnabledLibrarySources(db: Db, tmdb: ActiveTmdbSource): Promise<void> {
  const rows = await db.select().from(librarySources).where(eq(librarySources.enabled, true))
  for (const row of rows) {
    await syncLibrarySourceRow(db, row, tmdb).catch(() => undefined)
  }
}

async function syncLibrarySourceRow(
  db: Db,
  source: LibrarySource,
  tmdb: ActiveTmdbSource,
): Promise<LibrarySourceSyncResult> {
  try {
    const entries = await fetchEntries(source)
    const result = await importEntries(db, source.userId, entries, tmdb)
    await markSourceSynced(db, source, result, null)
    return result
  } catch (error) {
    await markSourceSynced(db, source, null, error instanceof Error ? error.message : 'Library source sync failed.')
    throw error
  }
}

async function fetchEntries(source: LibrarySource): Promise<DoubanMediaEntry[]> {
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

async function markSourceSynced(
  db: Db,
  source: LibrarySource,
  result: LibrarySourceSyncResult | null,
  error: string | null,
): Promise<void> {
  await db
    .update(librarySources)
    .set({
      lastSyncedAt: new Date().toISOString(),
      lastError: error,
      lastResultJson: result ? JSON.stringify(result) : source.lastResultJson,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(librarySources.id, source.id))
}

async function getLibrarySourceRow(db: Db, userId: string, source: LibrarySourceKind): Promise<LibrarySource | null> {
  const rows = await db
    .select()
    .from(librarySources)
    .where(and(eq(librarySources.userId, userId), eq(librarySources.source, source)))
    .limit(1)
  return rows[0] ?? null
}

function toSummary(row: LibrarySource): LibrarySourceSummary {
  return {
    id: row.id,
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

function normalizeProfileId(value: string): string {
  const trimmed = value.trim()
  const match = trimmed.match(/douban\.com\/people\/([^/?#]+)/)
  return decodeURIComponent(match?.[1] ?? trimmed)
}
