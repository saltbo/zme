import type {
  CreateDownloadInput,
  CreateDownloadResult,
  DownloaderDetails,
  DownloaderHealth,
  DownloaderInput,
  DownloaderSummary,
  FavoriteMediaInput,
  FavoriteMediaItem,
  IndexerDetails,
  IndexerHealth,
  IndexerInput,
  IndexerSearchItem,
  IndexerSummary,
  MediaDetails,
  MediaKind,
  MediaSearchItem,
  MediaSourceDetails,
  MediaSourceHealth,
  MediaSourceInput,
  MediaSourceSummary,
} from '@shared/types'

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function apiError(response: Response, fallbackMessage: string): Promise<ApiError> {
  try {
    const payload = (await response.clone().json()) as { error?: string; code?: string }
    return new ApiError(payload.error || fallbackMessage, response.status, payload.code)
  } catch {
    return new ApiError(fallbackMessage, response.status)
  }
}

async function apiRequest<T>(path: string, fallbackMessage: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  if (!response.ok) {
    throw await apiError(response, fallbackMessage)
  }

  return response.json() as Promise<T>
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const value = search.toString()
  return value ? `?${value}` : ''
}

function jsonBody(input: unknown): RequestInit {
  return {
    method: 'POST',
    body: JSON.stringify(input),
  }
}

export async function searchMedia(queryValue: string, language: string) {
  return apiRequest<{ results: MediaSearchItem[] }>(
    `/api/media/search${query({ q: queryValue, language })}`,
    'Failed to search media.',
  )
}

export async function getSetupStatus() {
  return apiRequest<{ initialized: boolean }>('/api/setup/status', 'Failed to load setup status.')
}

export async function createInitialAdmin(input: { name: string; email: string; password: string }) {
  return apiRequest<{ user: unknown }>('/api/setup/admin', 'Failed to create administrator.', jsonBody(input))
}

export async function getMediaDetails(kind: MediaKind, id: number, language: string) {
  return apiRequest<{ item: MediaDetails }>(
    `/api/media/${kind}/${id}${query({ language })}`,
    'Failed to load media details.',
  )
}

export async function getTrendingMedia(language: string) {
  return apiRequest<{ results: MediaSearchItem[] }>(
    `/api/media/trending${query({ language })}`,
    'Failed to load trending media.',
  )
}

export async function getPopularMedia(kind: MediaKind, language: string) {
  return apiRequest<{ results: MediaSearchItem[] }>(
    `/api/media/popular${query({ kind, language })}`,
    'Failed to load popular media.',
  )
}

export async function searchIndexers(queryValue: string) {
  return apiRequest<{ results: IndexerSearchItem[] }>(
    `/api/indexers/search${query({ q: queryValue })}`,
    'Failed to search indexers.',
  )
}

export async function listFavorites() {
  return apiRequest<{ items: FavoriteMediaItem[] }>('/api/favorites', 'Failed to load favorites.')
}

export async function createFavorite(input: FavoriteMediaInput) {
  return apiRequest<{ item: FavoriteMediaItem }>('/api/favorites', 'Failed to save favorite.', jsonBody(input))
}

export async function deleteFavorite(kind: MediaKind, id: number) {
  return apiRequest<{ kind: MediaKind; id: number }>(`/api/favorites/${kind}/${id}`, 'Failed to remove favorite.', {
    method: 'DELETE',
  })
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

export async function listMediaSources() {
  return apiRequest<{ items: MediaSourceSummary[] }>('/api/media-sources', 'Failed to load media sources.')
}

export async function createMediaSource(input: MediaSourceInput) {
  return apiRequest<{ item: MediaSourceSummary }>(
    '/api/media-sources',
    'Failed to create media source.',
    jsonBody(input),
  )
}

export async function getMediaSource(id: string) {
  return apiRequest<{ item: MediaSourceDetails }>(`/api/media-sources/${id}`, 'Failed to load media source.')
}

export async function updateMediaSource(id: string, input: MediaSourceInput) {
  return apiRequest<{ item: MediaSourceSummary }>(`/api/media-sources/${id}`, 'Failed to update media source.', {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export async function deleteMediaSource(id: string) {
  return apiRequest<{ id: string }>(`/api/media-sources/${id}`, 'Failed to delete media source.', {
    method: 'DELETE',
  })
}

export async function checkMediaSourceHealth(id: string) {
  return apiRequest<{ health: MediaSourceHealth }>(
    `/api/media-sources/${id}/health`,
    'Failed to check media source health.',
    { method: 'POST' },
  )
}

export async function listDownloaders() {
  return apiRequest<{ items: DownloaderSummary[] }>('/api/downloaders', 'Failed to load downloaders.')
}

export async function createDownloader(input: DownloaderInput) {
  return apiRequest<{ item: DownloaderSummary }>('/api/downloaders', 'Failed to create downloader.', jsonBody(input))
}

export async function getDownloader(id: string) {
  return apiRequest<{ item: DownloaderDetails }>(`/api/downloaders/${id}`, 'Failed to load downloader.')
}

export async function updateDownloader(id: string, input: DownloaderInput) {
  return apiRequest<{ item: DownloaderSummary }>(`/api/downloaders/${id}`, 'Failed to update downloader.', {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export async function deleteDownloader(id: string) {
  return apiRequest<{ id: string }>(`/api/downloaders/${id}`, 'Failed to delete downloader.', { method: 'DELETE' })
}

export async function checkDownloaderHealth(id: string) {
  return apiRequest<{ health: DownloaderHealth }>(
    `/api/downloaders/${id}/health`,
    'Failed to check downloader health.',
    { method: 'POST' },
  )
}

export async function createDownload(input: CreateDownloadInput) {
  return apiRequest<{ item: CreateDownloadResult }>('/api/downloads', 'Failed to submit download.', jsonBody(input))
}
