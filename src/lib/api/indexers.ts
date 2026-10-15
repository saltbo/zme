import type {
  DownloadSearchTarget,
  IndexerDetails,
  IndexerHealth,
  IndexerInput,
  IndexerSummary,
  Torrent,
  TorrentFull,
} from '@shared/types'
import { apiRequest, jsonBody, mergePatch, query } from './client'

export async function searchIndexerOnce(input: {
  mediaKey?: string
  query: string
  searchType?: 'search' | 'audiosearch' | 'booksearch'
  categories?: number[]
  target?: DownloadSearchTarget
}) {
  const response = await apiRequest<{ items: TorrentFull[] }>(
    `/api/torrents${query({
      mediaKey: input.mediaKey,
      q: input.query,
      target: input.target,
      view: 'full',
      page: 1,
      pageSize: 50,
    })}`,
    'Failed to search indexers.',
  )
  return { results: response.items }
}

export async function getTorrentResourceRef(self: string, context?: Pick<TorrentFull, 'mediaKey' | 'downloadTarget'>) {
  return apiRequest<Torrent & { resourceRef: string; resourceRefExpiresAt: string }>(
    `${self}${query({ mediaKey: context?.mediaKey, target: context?.downloadTarget ?? undefined })}`,
    'Failed to load torrent.',
  )
}

export async function listIndexers() {
  return apiRequest<{ items: IndexerSummary[] }>('/api/indexers', 'Failed to load indexers.')
}

export async function createIndexer(input: IndexerInput) {
  return apiRequest<IndexerSummary>('/api/indexers', 'Failed to create indexer.', jsonBody(input))
}

export async function getIndexer(id: string) {
  return apiRequest<IndexerDetails>(`/api/indexers/${id}`, 'Failed to load indexer.')
}

export async function updateIndexer(id: string, input: IndexerInput) {
  return apiRequest<IndexerSummary>(`/api/indexers/${id}`, 'Failed to update indexer.', {
    ...mergePatch(input),
  })
}

export async function deleteIndexer(id: string) {
  return apiRequest<void>(`/api/indexers/${id}`, 'Failed to delete indexer.', {
    method: 'DELETE',
  })
}

export async function checkIndexerHealth(id: string) {
  return apiRequest<IndexerHealth>(`/api/indexers/${id}/health`, 'Failed to check indexer health.', {
    method: 'GET',
    cache: 'no-store',
  })
}
