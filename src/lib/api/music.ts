import type { MusicAlbumDetails, MusicAlbumSearchItem, MusicDiscoveryInput, ResourcePage } from '@shared/types'
import { apiRequest, query } from './client'

export async function searchMusicAlbums(input: {
  query?: string
  artist?: string
  title?: string
  page: number
  pageSize?: number
}) {
  return apiRequest<ResourcePage<MusicAlbumSearchItem>>(
    `/api/music/search${query({
      q: input.query,
      artist: input.artist,
      title: input.title,
      page: input.page,
      pageSize: input.pageSize,
    })}`,
    'Failed to search music albums.',
  )
}

export async function discoverMusicAlbums(input: MusicDiscoveryInput) {
  return apiRequest<ResourcePage<MusicAlbumSearchItem>>(
    `/api/music/discover${query({
      mode: input.mode,
      range: input.range,
      chartType: input.chartType,
      genre: input.genre,
      releaseType: input.releaseType,
      year: /^(19|20)\d{2}$/.test(input.year ?? '') ? input.year : undefined,
      page: input.page,
      pageSize: input.pageSize,
    })}`,
    'Failed to load music.',
  )
}

export async function getMusicAlbumDetails(mediaKey: string) {
  return apiRequest<{ item: MusicAlbumDetails }>(
    `/api/music/details${query({ mediaKey })}`,
    'Failed to load music album details.',
  )
}
