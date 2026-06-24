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
  completed: number
  total: number
  active: number
  phase: 'primary' | 'fallback'
  steps: ReleaseSearchStepProgress[]
}

export interface ReleaseSearchStepProgress {
  id: string
  query: string
  phase: ReleaseSearchProgress['phase']
  status: 'pending' | 'running' | 'completed' | 'failed'
  resultCount: number | null
}

export type ReleaseSearchProgressHandler = (progress: ReleaseSearchProgress, results: IndexerSearchItem[]) => void

const releaseSearchConcurrency = 3

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
  let nextIndex = 0
  let active = 0
  let completed = 0
  const steps: ReleaseSearchStepProgress[] = searches.map((search, index) => ({
    id: `${phase}-${index}-${search.query}`,
    query: search.query,
    phase,
    status: 'pending',
    resultCount: null,
  }))

  if (searches.length === 0) return null

  await new Promise<void>((resolve) => {
    const emit = () => {
      onProgress(
        { completed, total: searches.length, active, phase, steps: steps.map((step) => ({ ...step })) },
        getResults(collected),
      )
    }

    const startNext = () => {
      while (active < releaseSearchConcurrency && nextIndex < searches.length) {
        const index = nextIndex
        nextIndex += 1
        active += 1
        steps[index] = { ...steps[index], status: 'running' }
        emit()

        void searchIndexerOnce({
          query: searches[index].query,
          searchType: 'searchType' in searches[index] ? searches[index].searchType : undefined,
          categories: 'categories' in searches[index] ? searches[index].categories : undefined,
        })
          .then((payload) => {
            collected.push(...payload.results)
            steps[index] = { ...steps[index], status: 'completed', resultCount: payload.results.length }
          })
          .catch((error) => {
            firstError ??= error instanceof Error ? error : new Error('Indexer search failed.')
            steps[index] = { ...steps[index], status: 'failed', resultCount: 0 }
          })
          .finally(() => {
            active -= 1
            completed += 1
            emit()
            if (completed === searches.length) {
              resolve()
              return
            }
            startNext()
          })
      }
    }

    startNext()
  })

  return firstError
}
