import type { AppType } from '@server/app'
import type { MediaKind } from '@shared/types'
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
