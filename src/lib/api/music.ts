import { parseMediaKey } from '@shared/media-key'
import type {
  CatalogAlbum,
  CatalogAlbumEdition,
  MusicAlbumDetails,
  MusicAlbumSearchItem,
  MusicDiscoveryInput,
  MusicReleaseSummary,
  MusicSearchItem,
  MusicTrackDownloadInput,
} from '@shared/types'
import { readChartEntries } from './charts'
import { apiRequest, apiResourcePage, jsonBody, query } from './client'

export async function searchMusicAlbums(input: {
  query?: string
  artist?: string
  title?: string
  page: number
  pageSize?: number
}) {
  return apiResourcePage<MusicAlbumSearchItem>(
    `/api/catalog/albums${query({
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
  if (input.mode === 'popular')
    return readChartEntries<MusicSearchItem>(
      input.chartType === 'tracks' ? 'recordings-popular' : 'album-editions-popular',
      {
        period: input.range === 'all_time' ? 'all' : input.range,
        page: input.page,
        pageSize: input.pageSize,
      },
    )
  return apiResourcePage<MusicSearchItem>(
    `/api/catalog/albums${query({
      genre: input.genre,
      releaseType: input.releaseType,
      year: /^(19|20)\d{2}$/.test(input.year ?? '') ? input.year : undefined,
      page: input.page,
      pageSize: input.pageSize,
    })}`,
    'Failed to load music.',
  )
}

export async function getMusicAlbumDetails(mediaKey: string): Promise<MusicAlbumDetails> {
  const isEdition = parseMediaKey(mediaKey)?.resourceType === 'release'
  const resource = await apiRequest<CatalogAlbum | CatalogAlbumEdition>(
    `/api/catalog/${isEdition ? 'album-editions' : 'albums'}/${encodeURIComponent(mediaKey)}`,
    'Failed to load music album details.',
  )
  const edition = 'preferredEdition' in resource ? resource.preferredEdition : resource
  const preferredRelease: MusicReleaseSummary | null = edition
    ? {
        mediaKey: edition.mediaKey,
        mbid: edition.mbid,
        title: edition.title,
        date: edition.releaseDate,
        country: edition.country,
        status: edition.status,
        barcode: edition.barcode,
        formats: edition.formats,
      }
    : null
  return {
    ...resource,
    detailMediaKey: resource.mediaKey,
    releaseMbid: edition?.mbid ?? null,
    preferredRelease,
    releases: preferredRelease ? [preferredRelease] : [],
    releaseDate: edition?.releaseDate ?? resource.firstReleaseDate,
    country: edition?.country ?? null,
    barcode: edition?.barcode ?? null,
    formats: edition?.formats ?? [],
    aliases: resource.aliases,
    media: edition?.discs ?? [],
  }
}

export async function submitMusicTrackDownload(mediaKey: string, input: MusicTrackDownloadInput) {
  const init = jsonBody({ resourceRef: `music-track:${mediaKey}`, downloaderId: input.downloaderId })
  init.headers = { 'Idempotency-Key': crypto.randomUUID() }
  return apiRequest('/api/downloads', 'Failed to submit music download.', init)
}
