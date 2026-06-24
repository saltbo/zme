import {
  buildTitleSearches,
  filterExactMediaMatches,
  getResourceSearchQueries,
  type ReleaseMatchCriteria,
  type ResourceDownloadSearchInput,
  type ResourceSearchQuery,
  scoreResourceResults,
  uniqueById,
} from '@shared/indexer-search'
import type { IndexerSearchItem } from '@shared/types'
import { searchIndexerOnce } from '@/lib/api'

export interface ReleaseSearchProgress {
  current: number
  total: number
  query: string
  phase: 'primary' | 'fallback'
}

export type ReleaseSearchProgressHandler = (progress: ReleaseSearchProgress, results: IndexerSearchItem[]) => void

export async function searchMediaReleasesInSteps(
  input: ReleaseMatchCriteria,
  onProgress: ReleaseSearchProgressHandler,
): Promise<IndexerSearchItem[]> {
  const searches = buildTitleSearches(input)
  const collected: IndexerSearchItem[] = []
  const firstError = await runSearches(searches, 'primary', collected, onProgress, (items) =>
    uniqueById(filterExactMediaMatches(items, input)),
  )
  const results = uniqueById(filterExactMediaMatches(collected, input))

  if (results.length === 0 && firstError && collected.length === 0) throw firstError
  return results
}

export async function searchResourceReleasesInSteps(
  input: ResourceDownloadSearchInput,
  onProgress: ReleaseSearchProgressHandler,
): Promise<IndexerSearchItem[]> {
  const collected: IndexerSearchItem[] = []
  const primary = getResourceSearchQueries(input, true)
  const primaryError = await runSearches(primary, 'primary', collected, onProgress, (items) =>
    scoreResourceResults(items, input),
  )
  const primaryResults = scoreResourceResults(collected, input)
  if (primaryResults.length > 0) return primaryResults

  const fallback = getResourceSearchQueries(input, false)
  const fallbackError = await runSearches(fallback, 'fallback', collected, onProgress, (items) =>
    scoreResourceResults(items, input),
  )
  const fallbackResults = scoreResourceResults(collected, input)

  if (fallbackResults.length === 0 && collected.length === 0) {
    const error = primaryError ?? fallbackError
    if (error) throw error
  }
  return fallbackResults
}

async function runSearches<T extends ResourceSearchQuery | ReleaseMatchCriteria>(
  searches: T[],
  phase: ReleaseSearchProgress['phase'],
  collected: IndexerSearchItem[],
  onProgress: ReleaseSearchProgressHandler,
  getResults: (items: IndexerSearchItem[]) => IndexerSearchItem[],
): Promise<Error | null> {
  let firstError: Error | null = null

  for (const [index, search] of searches.entries()) {
    const progress = { current: index + 1, total: searches.length, query: search.query, phase }
    onProgress(progress, getResults(collected))
    try {
      const payload = await searchIndexerOnce({
        query: search.query,
        searchType: 'searchType' in search ? search.searchType : undefined,
        categories: 'categories' in search ? search.categories : undefined,
      })
      collected.push(...payload.results)
    } catch (error) {
      firstError ??= error instanceof Error ? error : new Error('Indexer search failed.')
    }
    onProgress(progress, getResults(collected))
  }

  return firstError
}
