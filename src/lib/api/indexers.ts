import type { IndexerDetails, IndexerHealth, IndexerInput, IndexerSearchItem, IndexerSummary } from '@shared/types'
import { apiRequest, jsonBody, query } from './client'

export async function searchIndexerOnce(input: {
  query: string
  searchType?: 'search' | 'audiosearch' | 'booksearch'
  categories?: number[]
}) {
  return apiRequest<{ results: IndexerSearchItem[] }>(
    `/api/indexers/search${query({
      q: input.query,
      searchType: input.searchType,
      categories: input.categories?.join('|'),
    })}`,
    'Failed to search indexers.',
  )
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

export async function updateIndexer(id: string, input: IndexerInput) {
  return apiRequest<{ item: IndexerSummary }>(`/api/indexers/${id}`, 'Failed to update indexer.', {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export async function deleteIndexer(id: string) {
  return apiRequest<{ id: string }>(`/api/indexers/${id}`, 'Failed to delete indexer.', { method: 'DELETE' })
}

export async function checkIndexerHealth(id: string) {
  return apiRequest<{ health: IndexerHealth }>(`/api/indexers/${id}/health`, 'Failed to check indexer health.', {
    method: 'POST',
  })
}
