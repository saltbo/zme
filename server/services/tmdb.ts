import type {
  MediaCredit,
  MediaDetails,
  MediaDiscoverInput,
  MediaDiscoverPage,
  MediaGenre,
  MediaKind,
  MediaSearchItem,
} from '@shared/types'

interface TmdbSearchResponse {
  results?: TmdbSearchResult[]
  page?: number
  total_pages?: number
  total_results?: number
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
  genre_ids?: number[]
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
  translations?: {
    translations?: Array<{
      iso_639_1?: string
      data?: {
        title?: string
        name?: string
      }
    }>
  }
  alternative_titles?: {
    titles?: Array<{ title?: string }>
    results?: Array<{ title?: string }>
  }
}

interface TmdbCredit {
  name?: string
  job?: string
  department?: string
  character?: string
  profile_path?: string | null
}

interface TmdbGenreResponse {
  genres?: Array<{ id?: number; name?: string }>
}

const TMDB_API_BASE = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

export async function searchMedia(apiKey: string, query: string, language: string): Promise<MediaSearchItem[]> {
  const url = new URL(`${TMDB_API_BASE}/search/multi`)
  url.searchParams.set('query', query)
  url.searchParams.set('language', language)
  url.searchParams.set('include_adult', 'false')

  const [response, movieGenres, tvGenres] = await Promise.all([
    fetchTmdb(apiKey, url),
    listGenreMap(apiKey, 'movie', language),
    listGenreMap(apiKey, 'tv', language),
  ])
  const payload = (await response.json()) as TmdbSearchResponse
  return (payload.results ?? [])
    .filter((item) => item.media_type === 'movie' || item.media_type === 'tv')
    .map((item) => toMediaSearchItem(item, item.media_type === 'movie' ? movieGenres : tvGenres))
    .filter((item): item is MediaSearchItem => item !== null)
}

export async function getTrendingMedia(apiKey: string, language: string): Promise<MediaSearchItem[]> {
  const url = new URL(`${TMDB_API_BASE}/trending/all/day`)
  url.searchParams.set('language', language)

  const [response, movieGenres, tvGenres] = await Promise.all([
    fetchTmdb(apiKey, url),
    listGenreMap(apiKey, 'movie', language),
    listGenreMap(apiKey, 'tv', language),
  ])
  const payload = (await response.json()) as TmdbSearchResponse
  return (payload.results ?? [])
    .filter((item) => item.media_type === 'movie' || item.media_type === 'tv')
    .map((item) => toMediaSearchItem(item, item.media_type === 'movie' ? movieGenres : tvGenres))
    .filter((item): item is MediaSearchItem => item !== null)
}

export async function getPopularMedia(apiKey: string, kind: MediaKind, language: string): Promise<MediaSearchItem[]> {
  const endpoint = kind === 'movie' ? 'movie' : 'tv'
  const url = new URL(`${TMDB_API_BASE}/${endpoint}/popular`)
  url.searchParams.set('language', language)

  const [response, genres] = await Promise.all([fetchTmdb(apiKey, url), listGenreMap(apiKey, kind, language)])
  const payload = (await response.json()) as TmdbSearchResponse
  return (payload.results ?? [])
    .map((item) => toMediaSearchItem({ ...item, media_type: kind }, genres))
    .filter((item): item is MediaSearchItem => item !== null)
}

export async function discoverMedia(apiKey: string, input: MediaDiscoverInput): Promise<MediaDiscoverPage> {
  const endpoint = input.kind === 'movie' ? 'movie' : 'tv'
  const url = new URL(`${TMDB_API_BASE}/discover/${endpoint}`)
  url.searchParams.set('language', input.language)
  url.searchParams.set('include_adult', 'false')
  url.searchParams.set('page', String(input.page))
  url.searchParams.set('sort_by', input.sortBy ?? 'popularity.desc')

  if (input.genreId) url.searchParams.set('with_genres', String(input.genreId))
  if (input.originCountry) url.searchParams.set('with_origin_country', input.originCountry)
  if (input.ratingGte) url.searchParams.set('vote_average.gte', String(input.ratingGte))
  if (input.year) {
    url.searchParams.set(input.kind === 'movie' ? 'primary_release_year' : 'first_air_date_year', String(input.year))
  }

  const [response, genres] = await Promise.all([
    fetchTmdb(apiKey, url),
    listGenreMap(apiKey, input.kind, input.language),
  ])
  const payload = (await response.json()) as TmdbSearchResponse

  return {
    results: (payload.results ?? [])
      .map((item) => toMediaSearchItem({ ...item, media_type: input.kind }, genres))
      .filter((item): item is MediaSearchItem => item !== null),
    page: payload.page ?? input.page,
    totalPages: payload.total_pages ?? input.page,
    totalResults: payload.total_results ?? 0,
  }
}

export async function listMediaGenres(apiKey: string, kind: MediaKind, language: string): Promise<MediaGenre[]> {
  const endpoint = kind === 'movie' ? 'movie' : 'tv'
  const url = new URL(`${TMDB_API_BASE}/genre/${endpoint}/list`)
  url.searchParams.set('language', language)

  const response = await fetchTmdb(apiKey, url)
  const payload = (await response.json()) as TmdbGenreResponse
  return (payload.genres ?? [])
    .filter((genre): genre is { id: number; name: string } => Boolean(genre.id && genre.name))
    .map((genre) => ({ id: genre.id, name: genre.name }))
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
  url.searchParams.set('append_to_response', 'credits,external_ids,translations,alternative_titles')

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

function toMediaSearchItem(item: TmdbSearchResult, genreMap = new Map<number, string>()): MediaSearchItem | null {
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
    genres: (item.genre_ids ?? []).map((id) => genreMap.get(id)).filter((name): name is string => Boolean(name)),
  }
}

async function listGenreMap(apiKey: string, kind: MediaKind, language: string): Promise<Map<number, string>> {
  return new Map((await listMediaGenres(apiKey, kind, language)).map((genre) => [genre.id, genre.name]))
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
    aliases: getAliasTitles(kind, item, searchItem),
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

function getAliasTitles(kind: MediaKind, item: TmdbDetailsResponse, searchItem: MediaSearchItem): string[] {
  const values = new Set<string>()
  const add = (value: string | undefined) => {
    const normalized = value?.trim()
    if (normalized && normalized !== searchItem.title && normalized !== searchItem.originalTitle) {
      values.add(normalized)
    }
  }

  for (const translation of item.translations?.translations ?? []) {
    if (translation.iso_639_1 !== 'en') continue
    add(kind === 'movie' ? translation.data?.title : translation.data?.name)
  }

  for (const title of item.alternative_titles?.titles ?? []) {
    add(title.title)
  }
  for (const title of item.alternative_titles?.results ?? []) {
    add(title.title)
  }

  return [...values].slice(0, 6)
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
