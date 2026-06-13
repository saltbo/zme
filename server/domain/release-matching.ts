import type { IndexerSearchItem } from '@shared/types'

/** The identity hints used to verify that a release actually matches the requested media. */
export interface ReleaseMatchCriteria {
  query: string
  title?: string
  aliases?: string[]
  year?: string
  kind?: 'movie' | 'tv'
  imdbId?: string
  tmdbId?: number
  tvdbId?: number
}

/**
 * Keeps releases that either carry a matching external id, or carry no id at
 * all but match the expected title/year. Releases with a conflicting id are
 * dropped.
 */
export function filterExactMediaMatches(items: IndexerSearchItem[], input: ReleaseMatchCriteria): IndexerSearchItem[] {
  const imdbId = parseImdbNumber(input.imdbId)
  return items.filter((item) => {
    if (imdbId && item.imdbId === imdbId) return true
    if (input.tmdbId && item.tmdbId === input.tmdbId) return true
    if (input.tvdbId && item.tvdbId === input.tvdbId) return true
    if (item.imdbId || item.tmdbId || item.tvdbId) return false
    return matchesExpectedTitle(item, input)
  })
}

/** Expands one search into per-title queries (primary title plus aliases, capped at 3). */
export function buildTitleSearches<T extends ReleaseMatchCriteria>(input: T): T[] {
  const titles = uniqueStrings([input.title, ...(input.aliases ?? [])]).slice(0, 3)
  if (titles.length === 0) return [input]

  return titles.map((title) => ({
    ...input,
    query: [title, input.year].filter(Boolean).join(' '),
  }))
}

export function uniqueById(items: IndexerSearchItem[]): IndexerSearchItem[] {
  const seen = new Set<string>()
  const unique: IndexerSearchItem[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    unique.push(item)
  }
  return unique
}

export function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const value of values) {
    const normalized = value?.trim()
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(normalized)
  }
  return unique
}

export function normalizeReleaseText(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function matchesExpectedTitle(item: IndexerSearchItem, input: ReleaseMatchCriteria): boolean {
  if (input.kind === 'movie' && looksLikeMovieCollection(item.title)) return false

  const expectedTitles = uniqueStrings([input.title, ...(input.aliases ?? []), stripYear(input.query)])
    .map(normalizeReleaseText)
    .filter(Boolean)
  const releaseTitle = normalizeReleaseText(item.title)
  if (!expectedTitles.some((title) => releaseTitle.includes(title))) return false
  if (!input.year) return true

  return releaseTitle.includes(input.year)
}

function looksLikeMovieCollection(value: string): boolean {
  const normalized = normalizeReleaseText(value)
  return normalized.includes('合集') || normalized.includes('collection')
}

function stripYear(value: string): string {
  return value.replace(/\b(19|20)\d{2}\b/g, '').trim()
}

function parseImdbNumber(value: string | undefined): number | null {
  if (!value) return null
  const match = value.match(/^tt(\d+)$/i)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}
