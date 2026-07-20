import type {
  LibraryMediaPage,
  LibraryPageInput,
  LibraryResourceInput,
  LibraryResourceStateInput,
  LibraryStateItem,
  MusicCollectionDetails,
  MusicCollectionSummary,
  MusicFavoriteTrackInput,
} from '@shared/types'
import { apiRequest, query } from './client'

export async function listLibrary(input: LibraryPageInput) {
  return apiRequest<LibraryMediaPage>(
    `/api/library${query({
      page: input.page,
      pageSize: input.pageSize,
      language: input.language,
      kind: input.kind && input.kind !== 'all' ? input.kind : undefined,
      status: input.status && input.status !== 'all' ? input.status : undefined,
    })}`,
    'Failed to load library.',
  )
}

export async function listLibraryStates() {
  return apiRequest<{ items: LibraryStateItem[] }>('/api/library/states', 'Failed to load library states.')
}

export async function saveLibraryResource(input: LibraryResourceStateInput) {
  return apiRequest<{ item: LibraryStateItem }>('/api/library/resources', 'Failed to save library item.', {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export async function removeLibraryResource(input: LibraryResourceInput) {
  return apiRequest<{ mediaKey: string; kind: LibraryResourceInput['kind'] }>(
    `/api/library/resources/${encodeURIComponent(input.mediaKey)}`,
    'Failed to remove library item.',
    {
      method: 'DELETE',
      body: JSON.stringify(input),
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
  return apiRequest<{ item: MusicCollectionDetails }>(
    `/api/library/music/collections/${id}`,
    'Failed to load music collection.',
  )
}

export async function removeMusicCollection(id: string) {
  return apiRequest<{ id: string }>(`/api/library/music/collections/${id}`, 'Failed to remove music collection.', {
    method: 'DELETE',
  })
}

export async function saveMusicAlbum(mediaKey: string) {
  return apiRequest<{ item: MusicCollectionDetails }>('/api/library/music/albums', 'Failed to save music album.', {
    method: 'POST',
    body: JSON.stringify({ mediaKey }),
  })
}

export async function getFavoriteSongs() {
  return apiRequest<{ item: MusicCollectionDetails | null }>(
    '/api/library/music/favorites',
    'Failed to load favorite songs.',
  )
}

export async function setFavoriteSong(track: MusicFavoriteTrackInput, selected: boolean) {
  return apiRequest<{ item: MusicCollectionDetails | null }>(
    '/api/library/music/favorites',
    'Failed to update favorite song.',
    { method: 'PUT', body: JSON.stringify({ track, selected }) },
  )
}
