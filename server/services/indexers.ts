import type { IndexerDetails, IndexerHealth, IndexerInput, IndexerSearchItem, IndexerSummary } from '@shared/types'
import { indexerGateways } from '../adapters/gateways/indexers'
import { createIndexersRepo } from '../adapters/repos/indexers'
import type { createDb } from '../db/client'
import type { IndexerRecord, IndexerSearchInput } from '../usecases/ports'
import { type ResourceDownloadSearchInput, searchResourceDownloads } from './download-search'

type Db = ReturnType<typeof createDb>

export async function listIndexers(db: Db): Promise<IndexerSummary[]> {
  const records = await createIndexersRepo(db).list()
  return records.map(toSummary)
}

export async function getIndexer(db: Db, id: string): Promise<IndexerDetails | null> {
  const record = await createIndexersRepo(db).get(id)
  return record ? toDetails(record) : null
}

export async function createIndexer(db: Db, input: IndexerInput): Promise<IndexerSummary> {
  return toSummary(await createIndexersRepo(db).create(input))
}

export async function updateIndexer(db: Db, id: string, input: IndexerInput): Promise<IndexerSummary | null> {
  const record = await createIndexersRepo(db).update(id, input)
  return record ? toSummary(record) : null
}

export async function deleteIndexer(db: Db, id: string): Promise<boolean> {
  return createIndexersRepo(db).delete(id)
}

export async function searchIndexers(db: Db, input: IndexerSearchInput): Promise<IndexerSearchItem[]> {
  const rows = await createIndexersRepo(db).listEnabled()
  if (rows.length === 0) throw new Error('No enabled indexers are configured.')

  const searches = getSearchInputs(input)
  const results = await Promise.allSettled(searches.map((search) => searchEnabledIndexers(rows, search)))
  const items = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
  if (items.length > 0) return uniqueById(filterExactMediaMatches(items, input))

  const firstError = results.find((result) => result.status === 'rejected')
  if (firstError?.status === 'rejected' && firstError.reason instanceof Error) {
    throw firstError.reason
  }
  return []
}

export async function searchDownloadIndexers(db: Db, input: ResourceDownloadSearchInput): Promise<IndexerSearchItem[]> {
  const rows = await createIndexersRepo(db).listEnabled()
  if (rows.length === 0) throw new Error('No enabled indexers are configured.')

  return searchResourceDownloads(rows, input)
}

async function searchEnabledIndexers(rows: IndexerRecord[], input: IndexerSearchInput): Promise<IndexerSearchItem[]> {
  const results = await Promise.allSettled(
    rows.map((row) => indexerGateways[row.kind].search(row.config, input)),
  )
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

function filterExactMediaMatches(items: IndexerSearchItem[], input: IndexerSearchInput): IndexerSearchItem[] {
  const imdbId = parseImdbNumber(input.imdbId)
  return items.filter((item) => {
    if (imdbId && item.imdbId === imdbId) return true
    if (input.tmdbId && item.tmdbId === input.tmdbId) return true
    if (input.tvdbId && item.tvdbId === input.tvdbId) return true
    if (item.imdbId || item.tmdbId || item.tvdbId) return false
    return matchesExpectedTitle(item, input)
  })
}

function getSearchInputs(input: IndexerSearchInput): IndexerSearchInput[] {
  const titles = uniqueStrings([input.title, ...(input.aliases ?? [])]).slice(0, 3)
  if (titles.length === 0) return [input]

  return titles.map((title) => ({
    ...input,
    query: [title, input.year].filter(Boolean).join(' '),
  }))
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

function parseImdbNumber(value: string | undefined): number | null {
  if (!value) return null
  const match = value.match(/^tt(\d+)$/i)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function matchesExpectedTitle(item: IndexerSearchItem, input: IndexerSearchInput): boolean {
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

function normalizeReleaseText(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export async function checkIndexerHealth(db: Db, id: string): Promise<IndexerHealth | null> {
  const repo = createIndexersRepo(db)
  const indexer = await repo.get(id)
  if (!indexer) return null

  const checkedAt = new Date().toISOString()
  const result = await probeIndexer(indexer)
  const updated = await repo.setHealth(id, { ...result, checkedAt })
  if (!updated) return null

  return {
    status: updated.healthStatus === 'online' ? 'online' : 'offline',
    message: updated.healthMessage || result.message,
    checkedAt: updated.healthCheckedAt || checkedAt,
  }
}

function toSummary(record: IndexerRecord): IndexerSummary {
  return {
    id: record.id,
    description: record.description,
    kind: record.kind,
    endpoint: record.config.endpoint,
    enabled: record.enabled,
    healthStatus: record.healthStatus,
    healthMessage: record.healthMessage,
    healthCheckedAt: record.healthCheckedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function toDetails(record: IndexerRecord): IndexerDetails {
  return {
    ...toSummary(record),
    credentials: record.config.credentials,
    options: record.config.options,
  }
}

async function probeIndexer(indexer: IndexerRecord): Promise<{ status: 'online' | 'offline'; message: string }> {
  try {
    await indexerGateways[indexer.kind].probe(indexer.config)
    return { status: 'online', message: 'Connection check succeeded.' }
  } catch (error) {
    return {
      status: 'offline',
      message: error instanceof Error ? error.message : 'Connection check failed.',
    }
  }
}
