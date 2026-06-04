import type { IndexerDetails, IndexerHealth, IndexerInput, IndexerSearchItem, IndexerSummary } from '@shared/types'
import { and, eq } from 'drizzle-orm'
import type { createDb } from '../db/client'
import { type Indexer, indexers } from '../db/schema'
import { type ProwlarrSearchInput, searchProwlarr } from './prowlarr'

type Db = ReturnType<typeof createDb>

interface ProwlarrCredentials {
  apiKey?: string
}

export async function listIndexers(db: Db): Promise<IndexerSummary[]> {
  const rows = await db.select().from(indexers).orderBy(indexers.createdAt)
  return rows.map(toSummary)
}

export async function getIndexer(db: Db, id: string): Promise<IndexerDetails | null> {
  const rows = await db.select().from(indexers).where(eq(indexers.id, id)).limit(1)
  return rows[0] ? toDetails(rows[0]) : null
}

export async function createIndexer(db: Db, input: IndexerInput): Promise<IndexerSummary> {
  const now = new Date().toISOString()
  const row: Indexer = {
    id: crypto.randomUUID(),
    description: input.description || null,
    kind: input.kind,
    endpoint: input.endpoint,
    credentialsJson: JSON.stringify(input.credentials),
    optionsJson: JSON.stringify(input.options),
    enabled: input.enabled,
    healthStatus: 'unknown',
    healthMessage: null,
    healthCheckedAt: null,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(indexers).values(row)
  return toSummary(row)
}

export async function updateIndexer(db: Db, id: string, input: IndexerInput): Promise<IndexerSummary | null> {
  const updatedAt = new Date().toISOString()
  const rows = await db
    .update(indexers)
    .set({
      description: input.description || null,
      kind: input.kind,
      endpoint: input.endpoint,
      credentialsJson: JSON.stringify(input.credentials),
      optionsJson: JSON.stringify(input.options),
      enabled: input.enabled,
      updatedAt,
    })
    .where(eq(indexers.id, id))
    .returning()

  return rows[0] ? toSummary(rows[0]) : null
}

export async function deleteIndexer(db: Db, id: string): Promise<boolean> {
  const rows = await db.delete(indexers).where(eq(indexers.id, id)).returning({ id: indexers.id })
  return rows.length > 0
}

export async function searchIndexers(db: Db, input: ProwlarrSearchInput): Promise<IndexerSearchItem[]> {
  const rows = await db
    .select()
    .from(indexers)
    .where(and(eq(indexers.enabled, true), eq(indexers.kind, 'prowlarr')))
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

async function searchEnabledIndexers(rows: Indexer[], input: ProwlarrSearchInput): Promise<IndexerSearchItem[]> {
  const results = await Promise.allSettled(rows.map((row) => searchConfiguredIndexer(row, input)))
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

function filterExactMediaMatches(items: IndexerSearchItem[], input: ProwlarrSearchInput): IndexerSearchItem[] {
  const imdbId = parseImdbNumber(input.imdbId)
  return items.filter((item) => {
    if (imdbId && item.imdbId === imdbId) return true
    if (input.tmdbId && item.tmdbId === input.tmdbId) return true
    if (input.tvdbId && item.tvdbId === input.tvdbId) return true
    if (item.imdbId || item.tmdbId || item.tvdbId) return false
    return matchesExpectedTitle(item, input)
  })
}

function getSearchInputs(input: ProwlarrSearchInput): ProwlarrSearchInput[] {
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

function matchesExpectedTitle(item: IndexerSearchItem, input: ProwlarrSearchInput): boolean {
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
  const rows = await db.select().from(indexers).where(eq(indexers.id, id)).limit(1)
  const indexer = rows[0]
  if (!indexer) return null

  const checkedAt = new Date().toISOString()
  const result = await probeIndexer(indexer)
  const rowsAfterUpdate = await db
    .update(indexers)
    .set({
      healthStatus: result.status,
      healthMessage: result.message,
      healthCheckedAt: checkedAt,
      updatedAt: checkedAt,
    })
    .where(eq(indexers.id, id))
    .returning()

  const updated = rowsAfterUpdate[0]
  if (!updated) return null
  return {
    status: updated.healthStatus === 'online' ? 'online' : 'offline',
    message: updated.healthMessage || result.message,
    checkedAt: updated.healthCheckedAt || checkedAt,
  }
}

function toSummary(row: Indexer): IndexerSummary {
  return {
    id: row.id,
    description: row.description,
    kind: row.kind,
    endpoint: row.endpoint,
    enabled: row.enabled,
    healthStatus: row.healthStatus,
    healthMessage: row.healthMessage,
    healthCheckedAt: row.healthCheckedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toDetails(row: Indexer): IndexerDetails {
  return {
    ...toSummary(row),
    credentials: readJson<Record<string, string>>(row.credentialsJson),
    options: readJson<Record<string, string>>(row.optionsJson),
  }
}

async function searchConfiguredIndexer(indexer: Indexer, input: ProwlarrSearchInput): Promise<IndexerSearchItem[]> {
  const credentials = readJson<ProwlarrCredentials>(indexer.credentialsJson)
  if (!credentials.apiKey) throw new Error('Prowlarr API key is missing.')
  return searchProwlarr(indexer.endpoint, credentials.apiKey, input)
}

async function probeIndexer(indexer: Indexer): Promise<{ status: 'online' | 'offline'; message: string }> {
  try {
    const credentials = readJson<ProwlarrCredentials>(indexer.credentialsJson)
    if (!credentials.apiKey) throw new Error('Prowlarr API key is missing.')

    const response = await fetch(new URL('/api/v1/system/status', normalizeBaseUrl(indexer.endpoint)), {
      headers: {
        'X-Api-Key': credentials.apiKey,
        Accept: 'application/json',
      },
    })
    await assertOk(response, 'Prowlarr')
    return { status: 'online', message: 'Connection check succeeded.' }
  } catch (error) {
    return {
      status: 'offline',
      message: error instanceof Error ? error.message : 'Connection check failed.',
    }
  }
}

function readJson<T>(value: string): T {
  return JSON.parse(value) as T
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

async function assertOk(response: Response, target: string) {
  if (response.ok) return
  const text = await response.text()
  throw new Error(`${target} request failed: ${response.status}${text ? ` ${text}` : ''}`)
}
