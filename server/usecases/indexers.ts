import type { IndexerDetails, IndexerHealth, IndexerInput, IndexerSearchItem, IndexerSummary } from '@shared/types'
import { buildTitleSearches, filterExactMediaMatches, uniqueById } from '../domain/release-matching'
import type { ResourceDownloadSearchInput } from '../domain/resource-download-matching'
import type { Deps } from './deps'
import { searchResourceDownloads } from './download-search'
import { IndexerNotConfiguredError, type IndexerRecord, type IndexerSearchInput } from './ports'

export async function listIndexers(deps: Deps): Promise<IndexerSummary[]> {
  const records = await deps.indexersRepo.list()
  return records.map(toSummary)
}

export async function getIndexer(deps: Deps, id: string): Promise<IndexerDetails | null> {
  const record = await deps.indexersRepo.get(id)
  return record ? toDetails(record) : null
}

export async function createIndexer(deps: Deps, input: IndexerInput): Promise<IndexerSummary> {
  return toSummary(await deps.indexersRepo.create(input))
}

export async function updateIndexer(deps: Deps, id: string, input: IndexerInput): Promise<IndexerSummary | null> {
  const record = await deps.indexersRepo.update(id, input)
  return record ? toSummary(record) : null
}

export async function deleteIndexer(deps: Deps, id: string): Promise<boolean> {
  return deps.indexersRepo.delete(id)
}

export async function searchIndexers(deps: Deps, input: IndexerSearchInput): Promise<IndexerSearchItem[]> {
  const rows = await deps.indexersRepo.listEnabled()
  if (rows.length === 0) throw new IndexerNotConfiguredError()

  const searches = buildTitleSearches(input)
  const results = await Promise.allSettled(searches.map((search) => searchEnabledIndexers(deps, rows, search)))
  const items = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
  if (items.length > 0) return uniqueById(filterExactMediaMatches(items, input))

  const firstError = results.find((result) => result.status === 'rejected')
  if (firstError?.status === 'rejected' && firstError.reason instanceof Error) {
    throw firstError.reason
  }
  return []
}

export async function searchDownloadIndexers(
  deps: Deps,
  input: ResourceDownloadSearchInput,
): Promise<IndexerSearchItem[]> {
  const rows = await deps.indexersRepo.listEnabled()
  if (rows.length === 0) throw new IndexerNotConfiguredError()

  return searchResourceDownloads(deps, rows, input)
}

async function searchEnabledIndexers(
  deps: Deps,
  rows: IndexerRecord[],
  input: IndexerSearchInput,
): Promise<IndexerSearchItem[]> {
  const results = await Promise.allSettled(rows.map((row) => deps.indexerGateways[row.kind].search(row.config, input)))
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

export async function checkIndexerHealth(deps: Deps, id: string): Promise<IndexerHealth | null> {
  const indexer = await deps.indexersRepo.get(id)
  if (!indexer) return null

  const checkedAt = new Date().toISOString()
  const result = await probeIndexer(deps, indexer)
  const updated = await deps.indexersRepo.setHealth(id, { ...result, checkedAt })
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

async function probeIndexer(
  deps: Deps,
  indexer: IndexerRecord,
): Promise<{ status: 'online' | 'offline'; message: string }> {
  try {
    await deps.indexerGateways[indexer.kind].probe(indexer.config)
    return { status: 'online', message: 'Connection check succeeded.' }
  } catch (error) {
    return {
      status: 'offline',
      message: error instanceof Error ? error.message : 'Connection check failed.',
    }
  }
}
