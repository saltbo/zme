import type {
  DownloadSearchTarget,
  IndexerDetails,
  IndexerHealth,
  IndexerInput,
  IndexerSummary,
  ReleaseCandidateFull,
} from '@shared/types'
import { apiRequest, jsonBody, mergePatch, query } from './client'

export async function searchIndexerOnce(input: {
  mediaKey?: string
  query: string
  searchType?: 'search' | 'audiosearch' | 'booksearch'
  categories?: number[]
  target?: DownloadSearchTarget
}) {
  const response = await apiRequest<{ items: ReleaseCandidateFull[] }>(
    `/api/release-candidates${query({
      mediaKey: input.mediaKey,
      query: input.query,
      searchType: input.searchType,
      categories: input.categories?.join('|'),
      target: input.target,
      view: 'full',
      page: 1,
      pageSize: 50,
    })}`,
    'Failed to search indexers.',
  )
  return { results: response.items }
}

export async function listIndexers() {
  return apiRequest<{ items: IndexerSummary[] }>('/api/indexers', 'Failed to load indexers.')
}

export async function createIndexer(input: IndexerInput) {
  return apiRequest<{ item: IndexerSummary }>('/api/indexers', 'Failed to create indexer.', jsonBody(input))
}

export async function getIndexer(id: string) {
  return apiRequest<{ item: IndexerDetails }>(`/api/indexers/${id}`, 'Failed to load indexer.')
}

export async function updateIndexer(id: string, input: IndexerInput, expectedUpdatedAt: string) {
  return apiRequest<{ item: IndexerSummary }>(`/api/indexers/${id}`, 'Failed to update indexer.', {
    ...mergePatch(input),
    headers: { ...mergePatch(input).headers, 'If-Match': `"${expectedUpdatedAt}"` },
  })
}

export async function deleteIndexer(id: string, expectedUpdatedAt: string) {
  return apiRequest<void>(`/api/indexers/${id}`, 'Failed to delete indexer.', {
    method: 'DELETE',
    headers: { 'If-Match': `"${expectedUpdatedAt}"` },
  })
}

export async function checkIndexerHealth(id: string) {
  return apiRequest<{ item: IndexerHealth }>(
    `/api/indexers/${id}/health-observations`,
    'Failed to check indexer health.',
    { method: 'POST' },
  )
}
