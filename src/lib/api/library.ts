import type {
  LibraryMediaPage,
  LibraryPageInput,
  LibraryResourceInput,
  LibraryResourceStateInput,
  LibraryStateItem,
  MusicCollectionDetails,
  MusicCollectionSummary,
  MusicFavoriteTrackInput,
  MusicSubscriptionInput,
  MusicSubscriptionMutationResult,
} from '@shared/types'
import { ApiError, type ApiPage, apiRequest, query } from './client'

export async function listLibrary(input: LibraryPageInput) {
  const response = await apiRequest<ApiPage<LibraryMediaPage['items'][number]>>(
    `/api/library/items${query({
      page: input.page,
      pageSize: input.pageSize,
      language: input.language,
      kind: input.kind && input.kind !== 'all' ? input.kind : undefined,
      status: input.status && input.status !== 'all' ? input.status : undefined,
    })}`,
    'Failed to load library.',
  )
  return {
    items: response.items,
    page: response.pagination.page,
    pageSize: response.pagination.pageSize,
    totalResults: response.pagination.totalItems,
    totalPages: response.pagination.totalPages,
  }
}

export async function listLibraryStates() {
  return apiRequest<{ items: LibraryStateItem[] }>('/api/library/states', 'Failed to load library states.')
}

export async function saveLibraryResource(input: LibraryResourceStateInput) {
  return apiRequest<LibraryStateItem>(
    `/api/library/items/${encodeURIComponent(input.mediaKey)}`,
    'Failed to save library item.',
    {
      method: 'PUT',
      body: JSON.stringify({ status: input.status }),
    },
  )
}

export async function removeLibraryResource(input: LibraryResourceInput) {
  return apiRequest<{ mediaKey: string; kind: LibraryResourceInput['kind'] }>(
    `/api/library/items/${encodeURIComponent(input.mediaKey)}`,
    'Failed to remove library item.',
    {
      method: 'DELETE',
    },
  )
}

export async function listMusicCollections(kind: 'playlist' | 'album') {
  return apiRequest<{ items: MusicCollectionSummary[] }>(
    `/api/library/music/collections?kind=${kind}`,
    'Failed to load music collections.',
  )
}

export async function getMusicCollection(id: string) {
  return apiRequest<MusicCollectionDetails>(`/api/library/music/collections/${id}`, 'Failed to load music collection.')
}

export async function removeMusicCollection(id: string) {
  return apiRequest<{ id: string }>(`/api/library/music/collections/${id}`, 'Failed to remove music collection.', {
    method: 'DELETE',
  })
}

export async function enableMusicCollectionSubscription(id: string, input: MusicSubscriptionInput) {
  return apiRequest<MusicSubscriptionMutationResult>(
    `/api/library/music/collections/${id}/subscription`,
    'Failed to enable automatic downloads.',
    { method: 'PUT', body: JSON.stringify(input) },
  )
}

export async function disableMusicCollectionSubscription(id: string) {
  return apiRequest<MusicSubscriptionMutationResult>(
    `/api/library/music/collections/${id}/subscription`,
    'Failed to disable automatic downloads.',
    { method: 'DELETE' },
  )
}

export async function saveMusicAlbum(mediaKey: string) {
  return apiRequest<MusicCollectionDetails>('/api/library/music/albums', 'Failed to save music album.', {
    method: 'POST',
    body: JSON.stringify({ mediaKey }),
  })
}

export async function getFavoriteSongs() {
  try {
    return await apiRequest<MusicCollectionDetails>('/api/library/music/favorites', 'Failed to load favorite songs.')
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

export async function setFavoriteSong(track: MusicFavoriteTrackInput, selected: boolean) {
  return apiRequest<void>(
    `/api/library/music/favorites/tracks/${encodeURIComponent(track.mediaKey)}`,
    'Failed to update favorite song.',
    selected ? { method: 'PUT', body: JSON.stringify({ track }) } : { method: 'DELETE' },
  )
}
