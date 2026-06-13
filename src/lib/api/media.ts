import type {
  MediaDetails,
  MediaDiscoverInput,
  MediaDiscoverPage,
  MediaGenre,
  MediaKind,
  MediaPersonCredits,
  MediaSearchItem,
  MediaSeasonDetails,
  MediaWatchClickouts,
} from '@shared/types'
import { apiRequest, query } from './client'

export async function searchMedia(queryValue: string, language: string) {
  return apiRequest<{ results: MediaSearchItem[] }>(
    `/api/tmdb/search${query({ q: queryValue, language })}`,
    'Failed to search media.',
  )
}

export async function getMediaDetails(kind: MediaKind, id: number, language: string, watchRegion = 'US') {
  const resource = kind === 'movie' ? 'movies' : 'series'
  return apiRequest<{ item: MediaDetails }>(
    `/api/${resource}/${id}${query({ language, watchRegion })}`,
    'Failed to load media details.',
  )
}

export async function getSeasonDetails(seriesId: number, seasonNumber: number, language: string) {
  return apiRequest<{ item: MediaSeasonDetails }>(
    `/api/series/${seriesId}/seasons/${seasonNumber}${query({ language })}`,
    'Failed to load season details.',
  )
}

export async function getMediaWatchClickouts(kind: MediaKind, id: number, watchRegion = 'US') {
  const resource = kind === 'movie' ? 'movies' : 'series'
  return apiRequest<MediaWatchClickouts>(
    `/api/${resource}/${id}/watch-clickouts${query({ watchRegion })}`,
    'Failed to load watch links.',
  )
}

export async function getPersonCredits(id: number, language: string) {
  return apiRequest<MediaPersonCredits>(
    `/api/people/${id}/credits${query({ language })}`,
    'Failed to load person credits.',
  )
}

export async function getTrendingMedia(language: string) {
  return apiRequest<{ results: MediaSearchItem[] }>(
    `/api/tmdb/trending${query({ language })}`,
    'Failed to load trending media.',
  )
}

export async function getPopularMedia(kind: MediaKind, language: string) {
  return apiRequest<{ results: MediaSearchItem[] }>(
    `/api/tmdb/popular${query({ kind, language })}`,
    'Failed to load popular media.',
  )
}

export async function discoverMedia(input: MediaDiscoverInput) {
  return apiRequest<MediaDiscoverPage>(
    `/api/tmdb/discover${query({
      kind: input.kind,
      language: input.language,
      page: input.page,
      sortBy: input.sortBy,
      genreId: input.genreId,
      originCountry: input.originCountry,
      year: input.year,
      ratingGte: input.ratingGte,
    })}`,
    'Failed to discover media.',
  )
}

export async function listMediaGenres(kind: MediaKind, language: string) {
  return apiRequest<{ genres: MediaGenre[] }>(
    `/api/tmdb/genres${query({ kind, language })}`,
    'Failed to load media genres.',
  )
}
