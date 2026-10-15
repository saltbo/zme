import type {
  MediaDetails,
  MediaDiscoverInput,
  MediaGenre,
  MediaKind,
  MediaPersonCredits,
  MediaSearchItem,
  MediaSeasonDetails,
} from '@shared/types'
import { readChartEntries } from './charts'
import { apiRequest, apiResourcePage, query } from './client'

export async function searchMedia(queryValue: string, language: string) {
  const response = await apiRequest<{ items: MediaSearchItem[] }>(
    `/api/catalog/items${query({ q: queryValue, language })}`,
    'Failed to search media.',
  )
  return { results: response.items }
}

export async function getMediaDetails(kind: MediaKind, id: number, language: string, watchRegion = 'US') {
  const resource = kind === 'movie' ? 'movies' : 'series'
  return apiRequest<MediaDetails>(
    `/api/catalog/${resource}/${id}${query({ language, watchRegion })}`,
    'Failed to load media details.',
  )
}

export async function getSeasonDetails(seriesId: number, seasonNumber: number, language: string) {
  return apiRequest<MediaSeasonDetails>(
    `/api/catalog/series/${seriesId}/seasons/${seasonNumber}${query({ language })}`,
    'Failed to load season details.',
  )
}

export async function getMediaWatchClickouts(kind: MediaKind, id: number, watchRegion = 'US') {
  const resource = kind === 'movie' ? 'movies' : 'series'
  const response = await apiRequest<{ items: Array<{ provider: string; href: string }> }>(
    `/api/catalog/${resource}/${id}/watch-links${query({ watchRegion })}`,
    'Failed to load watch links.',
  )
  return Object.fromEntries(response.items.map((item) => [item.provider, item.href]))
}

export async function getPersonCredits(id: number, language: string) {
  const [person, credits] = await Promise.all([
    apiRequest<MediaPersonCredits['person']>(
      `/api/catalog/people/${id}${query({ language })}`,
      'Failed to load person.',
    ),
    apiRequest<{ items: Array<{ kind: 'cast'; media: MediaSearchItem }> }>(
      `/api/catalog/people/${id}/credits${query({ language })}`,
      'Failed to load person credits.',
    ),
  ])
  return { person, results: credits.items.map(({ media }) => media) }
}

export async function getTrendingMedia(language: string) {
  return readChartEntries<MediaSearchItem>('screen-trending', { language })
}

export async function getPopularMedia(kind: MediaKind, language: string) {
  return readChartEntries<MediaSearchItem>(kind === 'movie' ? 'movies-popular' : 'series-popular', { language })
}

export async function discoverMedia(input: MediaDiscoverInput) {
  return apiResourcePage<MediaSearchItem>(
    `/api/catalog/${input.kind === 'movie' ? 'movies' : 'series'}${query({
      language: input.language,
      page: input.page,
      orderBy:
        input.sortBy === 'vote_average.desc'
          ? 'rating desc'
          : input.sortBy === 'primary_release_date.desc' || input.sortBy === 'first_air_date.desc'
            ? 'releaseDate desc'
            : 'popularity desc',
      genreId: input.genreId,
      originCountry: input.originCountry,
      year: input.year,
      ratingGte: input.ratingGte,
    })}`,
    'Failed to discover media.',
  )
}

export async function listMediaGenres(kind: MediaKind, language: string) {
  return apiRequest<{ items: MediaGenre[] }>(
    `/api/catalog/genres${query({ mediaType: kind === 'movie' ? 'movie' : 'series', language })}`,
    'Failed to load media genres.',
  )
}
