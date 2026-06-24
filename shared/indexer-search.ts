import type { DownloadSearchTarget, IndexerSearchItem, MediaKind } from './types'

export interface ReleaseMatchCriteria {
  query: string
  title?: string
  aliases?: string[]
  year?: string | null
  kind?: MediaKind
  imdbId?: string | null
  tmdbId?: number | null
  tvdbId?: number | null
}

export interface ResourceDownloadSearchInput {
  target: DownloadSearchTarget
  query: string
  title?: string
  aliases?: string[]
  creators?: string[]
  year?: string | null
  formats?: string[]
  narrator?: string | null
}

export interface ResourceSearchQuery {
  query: string
  searchType: 'search' | 'audiosearch' | 'booksearch'
  categories?: number[]
}

interface TargetConfig {
  searchType: ResourceSearchQuery['searchType']
  categories: number[]
  categoryTerms: string[]
  formatTerms: string[]
  minimumScore: number
}

const targetConfigs: Record<DownloadSearchTarget, TargetConfig> = {
  music: {
    searchType: 'audiosearch',
    categories: [3000, 3040],
    categoryTerms: ['audio', 'music', 'mp3', 'lossless', 'flac'],
    formatTerms: ['flac', 'mp3', 'aac', 'm4a', 'lossless', 'cd'],
    minimumScore: 65,
  },
  ebook: {
    searchType: 'booksearch',
    categories: [7000, 7020],
    categoryTerms: ['books', 'ebook'],
    formatTerms: ['ebook', 'epub', 'mobi', 'azw3', 'pdf'],
    minimumScore: 65,
  },
  audiobook: {
    searchType: 'audiosearch',
    categories: [3030],
    categoryTerms: ['audio', 'audiobook'],
    formatTerms: ['audiobook', 'm4b', 'm4a', 'mp3'],
    minimumScore: 70,
  },
}

export function buildTitleSearches<T extends ReleaseMatchCriteria>(input: T): T[] {
  const titles = uniqueStrings([input.title, ...(input.aliases ?? [])]).slice(0, 8)
  if (titles.length === 0) return [input]

  return titles.map((title) => ({
    ...input,
    query: [title, input.year].filter(Boolean).join(' '),
  }))
}

export function filterExactMediaMatches(items: IndexerSearchItem[], input: ReleaseMatchCriteria): IndexerSearchItem[] {
  const imdbId = parseImdbNumber(input.imdbId ?? undefined)
  return items.filter((item) => {
    if (imdbId && item.imdbId === imdbId) return true
    if (input.tmdbId && item.tmdbId === input.tmdbId) return true
    if (input.tvdbId && item.tvdbId === input.tvdbId) return true
    if (item.imdbId || item.tmdbId || item.tvdbId) return false
    return matchesExpectedTitle(item, input)
  })
}

export function getResourceSearchQueries(
  input: ResourceDownloadSearchInput,
  includeCategories: boolean,
): ResourceSearchQuery[] {
  const config = targetConfigs[input.target]
  return buildResourceQueries(input).map((query) => ({
    query,
    searchType: config.searchType,
    categories: includeCategories ? config.categories : undefined,
  }))
}

export function scoreResourceResults(
  items: IndexerSearchItem[],
  input: ResourceDownloadSearchInput,
): IndexerSearchItem[] {
  const scoredItems: Array<{ item: IndexerSearchItem; score: number | null }> = items.map((item) => ({
    item: { ...item, downloadTarget: input.target },
    score: scoreResourceResult(item, input),
  }))
  const scored = scoredItems
    .filter((entry): entry is { item: IndexerSearchItem; score: number } => entry.score !== null)
    .sort((left, right) => right.score - left.score || (right.item.seeders ?? 0) - (left.item.seeders ?? 0))

  return uniqueById(scored.map((entry) => entry.item))
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

export function uniqueStrings(values: Array<string | null | undefined>): string[] {
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

function buildResourceQueries(input: ResourceDownloadSearchInput): string[] {
  const title = input.title?.trim() || input.query.trim()
  const aliases = uniqueStrings(input.aliases ?? []).slice(0, 2)
  const creators = uniqueStrings(input.creators ?? []).slice(0, 2)
  const formats = uniqueStrings(input.formats ?? []).slice(0, 2)
  const targetTerm = input.target === 'ebook' ? 'ebook' : input.target === 'audiobook' ? 'audiobook' : ''
  const primaryCreator = creators[0]

  return uniqueStrings([
    input.query,
    joinTerms([title, primaryCreator, input.year ?? undefined, formats[0] ?? targetTerm]),
    joinTerms([primaryCreator, title, input.year ?? undefined]),
    ...aliases.map((alias) => joinTerms([alias, primaryCreator, input.year ?? undefined, formats[0] ?? targetTerm])),
    ...formats.map((format) => joinTerms([title, primaryCreator, format])),
    input.narrator ? joinTerms([title, primaryCreator, input.narrator, targetTerm]) : undefined,
  ]).slice(0, 8)
}

function scoreResourceResult(item: IndexerSearchItem, input: ResourceDownloadSearchInput): number | null {
  const config = targetConfigs[input.target]
  const haystack = normalizeReleaseText(
    [item.title, item.fileName, item.categories.join(' ')].filter(Boolean).join(' '),
  )
  const titleCandidates = uniqueStrings([input.title || input.query, ...(input.aliases ?? [])]).map(
    normalizeReleaseText,
  )
  const creatorCandidates = uniqueStrings(input.creators ?? []).map(normalizeReleaseText)
  const formatCandidates = uniqueStrings([...(input.formats ?? []), ...config.formatTerms]).map(normalizeReleaseText)

  const titleMatch = titleCandidates.some((title) =>
    matchesTitle(haystack, title, creatorCandidates, input.year ?? undefined),
  )
  if (!titleMatch) return null

  const hasCreatorInput = creatorCandidates.length > 0
  const creatorMatch = !hasCreatorInput || creatorCandidates.some((creator) => textIncludesPhrase(haystack, creator))
  if (!creatorMatch) return null

  const categoryMatch = hasTargetCategory(item, config)
  if (hasCategoryEvidence(item) && !categoryMatch) return null

  let score = 50
  if (categoryMatch) score += 25
  if (hasCreatorInput) score += 20
  if (input.year && haystack.includes(input.year)) score += 8
  if (formatCandidates.some((format) => textIncludesPhrase(haystack, format))) score += 10
  if (input.narrator && textIncludesPhrase(haystack, normalizeReleaseText(input.narrator))) score += 12
  score += Math.min(item.seeders ?? 0, 50) / 10

  return score >= config.minimumScore ? score : null
}

function matchesExpectedTitle(item: IndexerSearchItem, input: ReleaseMatchCriteria): boolean {
  if (input.kind === 'movie' && looksLikeMovieCollection(item.title)) return false

  const expectedTitles = uniqueStrings([input.title, ...(input.aliases ?? []), stripYear(input.query)])
    .map(normalizeReleaseText)
    .filter(Boolean)
  const releaseTitle = normalizeReleaseText(item.title)
  if (!expectedTitles.some((title) => releaseTitle.includes(title))) return false
  if (!input.year) return true

  return releaseTitle.includes(input.year) || !hasReleaseYear(releaseTitle)
}

function hasCategoryEvidence(item: IndexerSearchItem): boolean {
  return item.categoryIds.length > 0 || item.categories.length > 0
}

function hasTargetCategory(item: IndexerSearchItem, config: TargetConfig): boolean {
  if (item.categoryIds.some((id) => config.categories.includes(id))) return true
  const categoryText = normalizeReleaseText(item.categories.join(' '))
  return config.categoryTerms.some((term) => textIncludesPhrase(categoryText, normalizeReleaseText(term)))
}

function matchesTitle(text: string, title: string, creators: string[], year: string | undefined): boolean {
  const titleTerms = title.split(' ')
  if (titleTerms.length > 1) return textIncludesPhrase(text, title)
  if (creators.some((creator) => textIncludesPhrase(text, `${creator} ${title}`))) return true
  if (year && textIncludesPhrase(text, `${title} ${year}`)) return true
  return creators.length === 0 && textIncludesPhrase(text, title)
}

function looksLikeMovieCollection(value: string): boolean {
  const normalized = normalizeReleaseText(value)
  return normalized.includes('合集') || normalized.includes('collection')
}

function stripYear(value: string): string {
  return value.replace(/\b(19|20)\d{2}\b/g, '').trim()
}

function hasReleaseYear(value: string): boolean {
  return /\b(19|20)\d{2}\b/.test(value)
}

function parseImdbNumber(value: string | undefined): number | null {
  if (!value) return null
  const match = value.match(/^tt(\d+)$/i)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function joinTerms(values: Array<string | undefined | null>): string {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(' ')
}

function textIncludesPhrase(text: string, phrase: string): boolean {
  if (!phrase) return false
  if (!phrase.includes(' ')) return text.split(' ').includes(phrase)
  return text.includes(phrase)
}
