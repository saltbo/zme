import type { AppType } from '@server/app'
import type { CreateDownloadInput, DownloaderInput, IndexerInput, MediaKind } from '@shared/types'
import { hc } from 'hono/client'

const client = hc<AppType>('/')

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

export async function searchMedia(query: string, language: string) {
  const response = await client.api.media.search.$get({
    query: {
      q: query,
      language,
    },
  })

  if (!response.ok) {
    throw await apiError(response, 'Failed to search media.')
  }

  return response.json()
}

export async function getMediaDetails(kind: MediaKind, id: number, language: string) {
  const response = await client.api.media[':kind'][':id'].$get({
    param: {
      kind,
      id: String(id),
    },
    query: {
      language,
    },
  })

  if (!response.ok) {
    throw await apiError(response, 'Failed to load media details.')
  }

  return response.json()
}

export async function getTrendingMedia(language: string) {
  const response = await client.api.media.trending.$get({
    query: {
      language,
    },
  })

  if (!response.ok) {
    throw await apiError(response, 'Failed to load trending media.')
  }

  return response.json()
}

export async function getPopularMedia(kind: MediaKind, language: string) {
  const response = await client.api.media.popular.$get({
    query: {
      kind,
      language,
    },
  })

  if (!response.ok) {
    throw await apiError(response, 'Failed to load popular media.')
  }

  return response.json()
}

export async function searchIndexers(query: string) {
  const response = await client.api.indexers.search.$get({
    query: {
      q: query,
    },
  })

  if (!response.ok) {
    throw await apiError(response, 'Failed to search indexers.')
  }

  return response.json()
}

export async function listIndexers() {
  const response = await client.api.indexers.$get()

  if (!response.ok) {
    throw await apiError(response, 'Failed to load indexers.')
  }

  return response.json()
}

export async function createIndexer(input: IndexerInput) {
  const response = await client.api.indexers.$post({
    json: input,
  })

  if (!response.ok) {
    throw await apiError(response, 'Failed to create indexer.')
  }

  return response.json()
}

export async function getIndexer(id: string) {
  const response = await client.api.indexers[':id'].$get({
    param: { id },
  })

  if (!response.ok) {
    throw await apiError(response, 'Failed to load indexer.')
  }

  return response.json()
}

export async function updateIndexer(id: string, input: IndexerInput) {
  const response = await client.api.indexers[':id'].$patch({
    param: { id },
    json: input,
  })

  if (!response.ok) {
    throw await apiError(response, 'Failed to update indexer.')
  }

  return response.json()
}

export async function deleteIndexer(id: string) {
  const response = await client.api.indexers[':id'].$delete({
    param: { id },
  })

  if (!response.ok) {
    throw await apiError(response, 'Failed to delete indexer.')
  }

  return response.json()
}

export async function checkIndexerHealth(id: string) {
  const response = await client.api.indexers[':id'].health.$post({
    param: { id },
  })

  if (!response.ok) {
    throw await apiError(response, 'Failed to check indexer health.')
  }

  return response.json()
}

export async function getZpanSaveUrl(uri: string) {
  const response = await client.api.zpan['save-url'].$get({
    query: {
      uri,
    },
  })

  if (!response.ok) {
    throw await apiError(response, 'Failed to build ZPan save URL.')
  }

  return response.json()
}

export async function listDownloaders() {
  const response = await client.api.downloaders.$get()

  if (!response.ok) {
    throw await apiError(response, 'Failed to load downloaders.')
  }

  return response.json()
}

export async function createDownloader(input: DownloaderInput) {
  const response = await client.api.downloaders.$post({
    json: input,
  })

  if (!response.ok) {
    throw await apiError(response, 'Failed to create downloader.')
  }

  return response.json()
}

export async function getDownloader(id: string) {
  const response = await client.api.downloaders[':id'].$get({
    param: { id },
  })

  if (!response.ok) {
    throw await apiError(response, 'Failed to load downloader.')
  }

  return response.json()
}

export async function updateDownloader(id: string, input: DownloaderInput) {
  const response = await client.api.downloaders[':id'].$patch({
    param: { id },
    json: input,
  })

  if (!response.ok) {
    throw await apiError(response, 'Failed to update downloader.')
  }

  return response.json()
}

export async function deleteDownloader(id: string) {
  const response = await client.api.downloaders[':id'].$delete({
    param: { id },
  })

  if (!response.ok) {
    throw await apiError(response, 'Failed to delete downloader.')
  }

  return response.json()
}

export async function checkDownloaderHealth(id: string) {
  const response = await client.api.downloaders[':id'].health.$post({
    param: { id },
  })

  if (!response.ok) {
    throw await apiError(response, 'Failed to check downloader health.')
  }

  return response.json()
}

export async function createDownload(input: CreateDownloadInput) {
  const response = await client.api.downloads.$post({
    json: input,
  })

  if (!response.ok) {
    throw await apiError(response, 'Failed to submit download.')
  }

  return response.json()
}
