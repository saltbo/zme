import {
  buildTitleSearches,
  filterExactMediaMatches,
  getResourceSearchQueries,
  type ReleaseMatchCriteria,
  type ReleaseTitleSearchKind,
  type ResourceDownloadSearchInput,
  scoreResourceResults,
  uniqueReleases,
} from '@shared/indexer-search'
import type { DownloadSearchTarget, ReleaseCandidateFull } from '@shared/types'
import { searchIndexerOnce } from '@/lib/api'

export interface ReleaseSearchProgress {
  completed: number
  total: number
  active: number
  phase: 'automatic' | 'exhaustive' | 'fallback'
  steps: ReleaseSearchStepProgress[]
}

export interface ReleaseSearchStepProgress {
  id: string
  query: string
  kind: ReleaseSearchStepKind
  status: 'pending' | 'running' | 'completed' | 'failed'
  resultCount: number | null
}

export type ReleaseSearchStepKind = ReleaseTitleSearchKind | 'targeted' | 'fallback'

export interface ReleaseSearchOutcome {
  items: ReleaseCandidateFull[]
  stoppedEarly: boolean
}

export interface MediaReleaseSearchOptions {
  exhaustive?: boolean
}

export type ReleaseSearchProgressHandler = (progress: ReleaseSearchProgress, results: ReleaseCandidateFull[]) => void

interface SearchTask {
  mediaKey?: string
  query: string
  kind: ReleaseSearchStepKind
  searchType?: 'search' | 'audiosearch' | 'booksearch'
  categories?: number[]
  target?: DownloadSearchTarget
}

export const automaticReleaseResultLimit = 30
const supplementarySearchBatchSize = 2
const resourceSearchConcurrency = 3

export async function searchMediaReleasesInSteps(
  input: ReleaseMatchCriteria,
  onProgress: ReleaseSearchProgressHandler,
  options: MediaReleaseSearchOptions = {},
): Promise<ReleaseSearchOutcome> {
  const searches = buildTitleSearches(input)
  const collected: ReleaseCandidateFull[] = []
  const getResults = (items: ReleaseCandidateFull[]) => uniqueReleases(filterExactMediaMatches(items, input))
  let firstError: Error | null = null
  const preferred = searches.filter((search) => search.titleKind === 'original' || search.titleKind === 'english')
  const supplemental = searches.filter((search) => search.titleKind !== 'original' && search.titleKind !== 'english')
  const batches = [
    preferred,
    ...Array.from({ length: Math.ceil(supplemental.length / supplementarySearchBatchSize) }, (_, index) =>
      supplemental.slice(index * supplementarySearchBatchSize, (index + 1) * supplementarySearchBatchSize),
    ),
  ]

  for (const [batchIndex, searchesInBatch] of batches.entries()) {
    const batch = searchesInBatch.map((search) => ({
      mediaKey: input.tmdbId && input.kind ? `tmdb:${input.kind}:${input.tmdbId}` : undefined,
      query: search.query,
      kind: search.titleKind,
    }))
    const error = await runSearches(
      batch,
      options.exhaustive ? 'exhaustive' : 'automatic',
      collected,
      onProgress,
      getResults,
      batch.length,
    )
    firstError ??= error

    const results = getResults(collected)
    if (!options.exhaustive && results.length >= automaticReleaseResultLimit && batchIndex < batches.length - 1) {
      return { items: results, stoppedEarly: true }
    }
  }

  const results = getResults(collected)
  if (results.length === 0 && firstError && collected.length === 0) throw firstError
  return { items: results, stoppedEarly: false }
}

export async function searchResourceReleasesInSteps(
  input: ResourceDownloadSearchInput,
  onProgress: ReleaseSearchProgressHandler,
): Promise<ReleaseSearchOutcome> {
  const collected: ReleaseCandidateFull[] = []
  const targeted = getResourceSearchQueries(input, true).map((search) => ({
    ...search,
    mediaKey: input.mediaKey,
    target: input.target,
    kind: 'targeted' as const,
  }))
  const primaryError = await runSearches(
    targeted,
    'automatic',
    collected,
    onProgress,
    (items) => scoreResourceResults(items, input),
    resourceSearchConcurrency,
  )
  const primaryResults = scoreResourceResults(collected, input)
  if (primaryResults.length > 0) return { items: primaryResults, stoppedEarly: false }

  const fallback = getResourceSearchQueries(input, false).map((search) => ({
    ...search,
    mediaKey: input.mediaKey,
    target: input.target,
    kind: 'fallback' as const,
  }))
  const fallbackError = await runSearches(
    fallback,
    'fallback',
    collected,
    onProgress,
    (items) => scoreResourceResults(items, input),
    resourceSearchConcurrency,
  )
  const fallbackResults = scoreResourceResults(collected, input)

  if (fallbackResults.length === 0 && collected.length === 0) {
    const error = primaryError ?? fallbackError
    if (error) throw error
  }
  return { items: fallbackResults, stoppedEarly: false }
}

async function runSearches(
  searches: SearchTask[],
  phase: ReleaseSearchProgress['phase'],
  collected: ReleaseCandidateFull[],
  onProgress: ReleaseSearchProgressHandler,
  getResults: (items: ReleaseCandidateFull[]) => ReleaseCandidateFull[],
  concurrency: number,
): Promise<Error | null> {
  let firstError: Error | null = null
  let nextIndex = 0
  let active = 0
  let completed = 0
  const steps: ReleaseSearchStepProgress[] = searches.map((search, index) => ({
    id: `${phase}-${index}-${search.query}`,
    query: search.query,
    kind: search.kind,
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
      while (active < concurrency && nextIndex < searches.length) {
        const index = nextIndex
        nextIndex += 1
        active += 1
        steps[index] = { ...steps[index], status: 'running' }
        emit()

        void searchIndexerOnce({
          mediaKey: searches[index].mediaKey,
          query: searches[index].query,
          searchType: searches[index].searchType,
          categories: searches[index].categories,
          target: searches[index].target,
        })
          .then((payload) => {
            const previousResultCount = getResults(collected).length
            collected.push(...payload.results)
            const resultCount = getResults(collected).length - previousResultCount
            steps[index] = { ...steps[index], status: 'completed', resultCount }
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
