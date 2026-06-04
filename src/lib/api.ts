import type { AppType } from '@server/app'
import { hc } from 'hono/client'

const client = hc<AppType>('/')

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function searchMedia(query: string) {
  const response = await client.api.media.search.$get({
    query: {
      q: query,
    },
  })

  if (!response.ok) {
    throw new ApiError('Failed to search media.', response.status)
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
    throw new ApiError('Failed to search indexers.', response.status)
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
    throw new ApiError('Failed to build ZPan save URL.', response.status)
  }

  return response.json()
}
