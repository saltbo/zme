import type { MediaCredit, MediaDetails, MediaKind, MediaSearchItem } from '@shared/types'

interface TmdbSearchResponse {
  results?: TmdbSearchResult[]
}

interface TmdbSearchResult {
  id?: number
  media_type?: string
  title?: string
  name?: string
  original_title?: string
  original_name?: string
  overview?: string
  poster_path?: string | null
  backdrop_path?: string | null
  release_date?: string
  first_air_date?: string
  vote_average?: number
}

interface TmdbDetailsResponse extends TmdbSearchResult {
  adult?: boolean
  genres?: Array<{ name?: string }>
  runtime?: number | null
  episode_run_time?: number[]
  original_language?: string
  production_countries?: Array<{ name?: string }>
  origin_country?: string[]
  created_by?: Array<{ name?: string }>
  credits?: {
    cast?: TmdbCredit[]
    crew?: TmdbCredit[]
  }
  external_ids?: {
    imdb_id?: string | null
    tvdb_id?: number | null
  }
}

interface TmdbCredit {
  name?: string
  job?: string
  department?: string
  character?: string
  profile_path?: string | null
}

const TMDB_API_BASE = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

export async function searchMedia(apiKey: string, query: string, language: string): Promise<MediaSearchItem[]> {
  const url = new URL(`${TMDB_API_BASE}/search/multi`)
  url.searchParams.set('query', query)
  url.searchParams.set('language', language)
  url.searchParams.set('include_adult', 'false')

  const response = await fetchTmdb(apiKey, url)
  const payload = (await response.json()) as TmdbSearchResponse
  return (payload.results ?? [])
    .filter((item) => item.media_type === 'movie' || item.media_type === 'tv')
    .map(toMediaSearchItem)
    .filter((item): item is MediaSearchItem => item !== null)
}

export async function getTrendingMedia(apiKey: string, language: string): Promise<MediaSearchItem[]> {
  const url = new URL(`${TMDB_API_BASE}/trending/all/day`)
  url.searchParams.set('language', language)

  const response = await fetchTmdb(apiKey, url)
  const payload = (await response.json()) as TmdbSearchResponse
  return (payload.results ?? [])
    .filter((item) => item.media_type === 'movie' || item.media_type === 'tv')
    .map(toMediaSearchItem)
    .filter((item): item is MediaSearchItem => item !== null)
}

export async function getPopularMedia(apiKey: string, kind: MediaKind, language: string): Promise<MediaSearchItem[]> {
  const endpoint = kind === 'movie' ? 'movie' : 'tv'
  const url = new URL(`${TMDB_API_BASE}/${endpoint}/popular`)
  url.searchParams.set('language', language)

  const response = await fetchTmdb(apiKey, url)
  const payload = (await response.json()) as TmdbSearchResponse
  return (payload.results ?? [])
    .map((item) => toMediaSearchItem({ ...item, media_type: kind }))
    .filter((item): item is MediaSearchItem => item !== null)
}

export async function getMediaDetails(
  apiKey: string,
  kind: MediaKind,
  id: number,
  language: string,
): Promise<MediaDetails> {
  const endpoint = kind === 'movie' ? 'movie' : 'tv'
  const url = new URL(`${TMDB_API_BASE}/${endpoint}/${id}`)
  url.searchParams.set('language', language)
  url.searchParams.set('append_to_response', 'credits,external_ids')

  const response = await fetchTmdb(apiKey, url)
  const payload = (await response.json()) as TmdbDetailsResponse
  return toMediaDetails(kind, payload)
}

async function fetchTmdb(apiKey: string, url: URL): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`TMDB request failed: ${response.status}`)
  }

  return response
}

function toMediaSearchItem(item: TmdbSearchResult): MediaSearchItem | null {
  if (!item.id || (item.media_type !== 'movie' && item.media_type !== 'tv')) {
    return null
  }

  const kind = item.media_type as MediaKind
  const title = kind === 'movie' ? item.title : item.name
  const originalTitle = kind === 'movie' ? item.original_title : item.original_name
  const date = kind === 'movie' ? item.release_date : item.first_air_date

  if (!title) {
    return null
  }

  return {
    id: item.id,
    kind,
    title,
    originalTitle: originalTitle || title,
    overview: item.overview || '',
    posterUrl: item.poster_path ? `${TMDB_IMAGE_BASE}/w342${item.poster_path}` : null,
    backdropUrl: item.backdrop_path ? `${TMDB_IMAGE_BASE}/w780${item.backdrop_path}` : null,
    releaseYear: date ? date.slice(0, 4) : null,
    rating: typeof item.vote_average === 'number' ? item.vote_average : null,
  }
}

function toMediaDetails(kind: MediaKind, item: TmdbDetailsResponse): MediaDetails {
  const searchItem = toMediaSearchItem({
    ...item,
    media_type: kind,
  })

  if (!searchItem) {
    throw new Error('TMDB details response is missing required media fields.')
  }

  const directors = kind === 'movie' ? getCrewNames(item.credits?.crew, ['Director']) : getCreatorNames(item)
  const writers = getCrewNames(item.credits?.crew, ['Writer', 'Screenplay', 'Story', 'Novel', 'Teleplay'])
  const runtimeMinutes = kind === 'movie' ? item.runtime : item.episode_run_time?.[0]

  return {
    ...searchItem,
    genres: (item.genres ?? []).map((genre) => genre.name).filter((name): name is string => Boolean(name)),
    runtime: typeof runtimeMinutes === 'number' && runtimeMinutes > 0 ? formatRuntime(runtimeMinutes) : null,
    language: item.original_language?.toUpperCase() ?? null,
    country: item.production_countries?.[0]?.name ?? item.origin_country?.[0] ?? null,
    director: directors[0] ?? null,
    writers,
    cast: toMediaCredits(item.credits?.cast ?? []),
    ids: {
      tmdb: String(searchItem.id),
      imdb: item.external_ids?.imdb_id ?? null,
      tvdb: item.external_ids?.tvdb_id ? String(item.external_ids.tvdb_id) : null,
    },
  }
}

function getCrewNames(crew: TmdbCredit[] | undefined, jobs: string[]): string[] {
  const names = new Set<string>()
  for (const credit of crew ?? []) {
    if (credit.name && credit.job && jobs.includes(credit.job)) {
      names.add(credit.name)
    }
  }
  return [...names]
}

function getCreatorNames(item: TmdbDetailsResponse): string[] {
  return (item.created_by ?? []).map((creator) => creator.name).filter((name): name is string => Boolean(name))
}

function toMediaCredits(cast: TmdbCredit[]): MediaCredit[] {
  return cast
    .filter((credit) => credit.name)
    .slice(0, 12)
    .map((credit) => ({
      name: credit.name as string,
      role: credit.character || 'Cast',
      portraitUrl: credit.profile_path ? `${TMDB_IMAGE_BASE}/w342${credit.profile_path}` : null,
    }))
}

function formatRuntime(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours === 0) return `${remainingMinutes}m`
  if (remainingMinutes === 0) return `${hours}h`
  return `${hours}h ${remainingMinutes}m`
}
