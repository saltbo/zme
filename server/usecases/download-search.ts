import {
  getResourceSearchQueries,
  type ResourceDownloadSearchInput,
  scoreResourceResults,
} from '@server/domain/resource-download-matching'
import type { IndexerSearchItem } from '@shared/types'
import type { Deps } from './deps'
import type { IndexerRecord, IndexerSearchInput } from './ports'

export type { ResourceDownloadSearchInput }

export async function searchResourceDownloads(
  deps: Deps,
  indexers: IndexerRecord[],
  input: ResourceDownloadSearchInput,
): Promise<IndexerSearchItem[]> {
  const searches = getResourceSearchQueries(input, true)
  const results = await Promise.allSettled(searches.map((search) => searchEnabledIndexers(deps, indexers, search)))
  const items = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
  const scoredItems = scoreResourceResults(items, input)
  if (scoredItems.length > 0) return scoredItems

  const fallbackSearches = getResourceSearchQueries(input, false)
  const fallbackResults = await Promise.allSettled(
    fallbackSearches.map((search) => searchEnabledIndexers(deps, indexers, search)),
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

async function searchEnabledIndexers(
  deps: Deps,
  indexers: IndexerRecord[],
  input: IndexerSearchInput,
): Promise<IndexerSearchItem[]> {
  const results = await Promise.allSettled(
    indexers.map((indexer) => deps.indexerGateways[indexer.kind].search(indexer.config, input)),
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
