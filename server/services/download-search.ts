import type { DownloadSearchTarget, IndexerSearchItem } from '@shared/types'
import { indexerGateways } from '../adapters/gateways/indexers'
import type { IndexerRecord, IndexerSearchInput } from '../usecases/ports'

export interface ResourceDownloadSearchInput {
  target: DownloadSearchTarget
  query: string
  title?: string
  aliases?: string[]
  creators?: string[]
  year?: string
  formats?: string[]
  narrator?: string
}

interface TargetConfig {
  searchType: NonNullable<IndexerSearchInput['searchType']>
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

export async function searchResourceDownloads(
  indexers: IndexerRecord[],
  input: ResourceDownloadSearchInput,
): Promise<IndexerSearchItem[]> {
  const searches = getResourceSearchInputs(input, true)
  const results = await Promise.allSettled(searches.map((search) => searchEnabledIndexers(indexers, search)))
  const items = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
  const scoredItems = scoreResourceResults(items, input)
  if (scoredItems.length > 0) return scoredItems

  const fallbackSearches = getResourceSearchInputs(input, false)
  const fallbackResults = await Promise.allSettled(
    fallbackSearches.map((search) => searchEnabledIndexers(indexers, search)),
  )
  const fallbackItems = fallbackResults.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
  const scoredFallbackItems = scoreResourceResults(fallbackItems, input)
  if (scoredFallbackItems.length > 0) return scoredFallbackItems

  const firstError =
    results.find((result) => result.status === 'rejected') ??
    fallbackResults.find((result) => result.status === 'rejected')
  if (firstError?.status === 'rejected' && firstError.reason instanceof Error) {
    throw firstError.reason
  }
  return []
}

async function searchEnabledIndexers(indexers: IndexerRecord[], input: IndexerSearchInput): Promise<IndexerSearchItem[]> {
  const results = await Promise.allSettled(indexers.map((indexer) => searchConfiguredIndexer(indexer, input)))
  const items = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
  if (items.length > 0) return items

  const firstError = results.find((result) => result.status === 'rejected')
  const hasSuccessfulSearch = results.some((result) => result.status === 'fulfilled')
  if (hasSuccessfulSearch) return []

  if (firstError?.status === 'rejected' && firstError.reason instanceof Error) {
    throw firstError.reason
  }
  throw new Error('Indexer search failed.')
}

function searchConfiguredIndexer(indexer: IndexerRecord, input: IndexerSearchInput): Promise<IndexerSearchItem[]> {
  return indexerGateways[indexer.kind].search(indexer.config, input)
}

function getResourceSearchInputs(
  input: ResourceDownloadSearchInput,
  includeCategories: boolean,
): IndexerSearchInput[] {
  const config = targetConfigs[input.target]
  return buildResourceQueries(input).map((query) => ({
    query,
    searchType: config.searchType,
    categories: includeCategories ? config.categories : undefined,
  }))
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
    joinTerms([title, primaryCreator, input.year, formats[0] ?? targetTerm]),
    joinTerms([primaryCreator, title, input.year]),
    ...aliases.map((alias) => joinTerms([alias, primaryCreator, input.year, formats[0] ?? targetTerm])),
    ...formats.map((format) => joinTerms([title, primaryCreator, format])),
    input.narrator ? joinTerms([title, primaryCreator, input.narrator, targetTerm]) : undefined,
  ]).slice(0, 8)
}

function scoreResourceResults(items: IndexerSearchItem[], input: ResourceDownloadSearchInput): IndexerSearchItem[] {
  const scoredItems: Array<{ item: IndexerSearchItem; score: number | null }> = items.map((item) => ({
    item: { ...item, downloadTarget: input.target },
    score: scoreResourceResult(item, input),
  }))
  const scored = scoredItems
    .filter((entry): entry is { item: IndexerSearchItem; score: number } => entry.score !== null)
    .sort((left, right) => right.score - left.score || (right.item.seeders ?? 0) - (left.item.seeders ?? 0))

  return uniqueById(scored.map((entry) => entry.item))
}

function scoreResourceResult(item: IndexerSearchItem, input: ResourceDownloadSearchInput): number | null {
  const config = targetConfigs[input.target]
  const haystack = normalizeSearchText([item.title, item.fileName, item.categories.join(' ')].filter(Boolean).join(' '))
  const titleCandidates = uniqueStrings([input.title || input.query, ...(input.aliases ?? [])]).map(normalizeSearchText)
  const creatorCandidates = uniqueStrings(input.creators ?? []).map(normalizeSearchText)
  const formatCandidates = uniqueStrings([...(input.formats ?? []), ...config.formatTerms]).map(normalizeSearchText)

  const titleMatch = titleCandidates.some((title) => matchesTitle(haystack, title, creatorCandidates, input.year))
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
  if (input.narrator && textIncludesPhrase(haystack, normalizeSearchText(input.narrator))) score += 12
  score += Math.min(item.seeders ?? 0, 50) / 10

  return score >= config.minimumScore ? score : null
}

function hasCategoryEvidence(item: IndexerSearchItem): boolean {
  return item.categoryIds.length > 0 || item.categories.length > 0
}

function hasTargetCategory(item: IndexerSearchItem, config: TargetConfig): boolean {
  if (item.categoryIds.some((id) => config.categories.includes(id))) return true
  const categoryText = normalizeSearchText(item.categories.join(' '))
  return config.categoryTerms.some((term) => textIncludesPhrase(categoryText, normalizeSearchText(term)))
}

function matchesTitle(text: string, title: string, creators: string[], year: string | undefined): boolean {
  const titleTerms = title.split(' ')
  if (titleTerms.length > 1) return textIncludesPhrase(text, title)
  if (creators.some((creator) => textIncludesPhrase(text, `${creator} ${title}`))) return true
  if (year && textIncludesPhrase(text, `${title} ${year}`)) return true
  return creators.length === 0 && textIncludesPhrase(text, title)
}

function uniqueById(items: IndexerSearchItem[]): IndexerSearchItem[] {
  const seen = new Set<string>()
  const unique: IndexerSearchItem[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    unique.push(item)
  }
  return unique
}

function uniqueStrings(values: Array<string | undefined>): string[] {
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

function joinTerms(values: Array<string | undefined>): string {
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

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}
