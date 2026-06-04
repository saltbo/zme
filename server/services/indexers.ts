import type { IndexerDetails, IndexerHealth, IndexerInput, IndexerSearchItem, IndexerSummary } from '@shared/types'
import { and, eq } from 'drizzle-orm'
import type { createDb } from '../db/client'
import { type Indexer, indexers } from '../db/schema'
import { searchProwlarr } from './prowlarr'

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

export async function searchIndexers(db: Db, query: string): Promise<IndexerSearchItem[]> {
  const rows = await db
    .select()
    .from(indexers)
    .where(and(eq(indexers.enabled, true), eq(indexers.kind, 'prowlarr')))
  if (rows.length === 0) throw new Error('No enabled indexers are configured.')

  const results = await Promise.allSettled(rows.map((row) => searchConfiguredIndexer(row, query)))
  const items = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
  if (items.length > 0) return items

  const firstError = results.find((result) => result.status === 'rejected')
  if (firstError?.status === 'rejected' && firstError.reason instanceof Error) {
    throw firstError.reason
  }
  throw new Error('Indexer search failed.')
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

async function searchConfiguredIndexer(indexer: Indexer, query: string): Promise<IndexerSearchItem[]> {
  const credentials = readJson<ProwlarrCredentials>(indexer.credentialsJson)
  if (!credentials.apiKey) throw new Error('Prowlarr API key is missing.')
  return searchProwlarr(indexer.endpoint, credentials.apiKey, query)
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
