import type {
  MediaCredit,
  MediaDetails,
  MediaDiscoverInput,
  MediaDiscoverPage,
  MediaGenre,
  MediaImage,
  MediaKind,
  MediaPersonCredits,
  MediaReleaseInfo,
  MediaSearchItem,
  MediaSeasonDetails,
  MediaSeasonSummary,
  MediaVideo,
  MediaWatchInfo,
  MediaWatchProviderGroup,
} from '@shared/types'
import type { MediaProvider } from '../../usecases/ports'

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
  popularity?: number
}

interface TmdbDetailsResponse extends TmdbSearchResult {
  adult?: boolean
  homepage?: string | null
  status?: string | null
  tagline?: string | null
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
  'watch/providers'?: {
    results?: Record<string, TmdbWatchRegion>
  }
  videos?: {
    results?: TmdbVideo[]
  }
  images?: {
    backdrops?: TmdbImage[]
    posters?: TmdbImage[]
    logos?: TmdbImage[]
  }
  recommendations?: TmdbSearchResponse
  similar?: TmdbSearchResponse
  release_dates?: {
    results?: Array<{
      iso_3166_1?: string
      release_dates?: Array<{
        certification?: string
        release_date?: string
        type?: number
      }>
    }>
  }
  content_ratings?: {
    results?: Array<{
      iso_3166_1?: string
      rating?: string
    }>
  }
  seasons?: TmdbSeason[]
}

interface TmdbSeason {
  id?: number
  name?: string
  overview?: string
  poster_path?: string | null
  air_date?: string | null
  episode_count?: number
  season_number?: number
  vote_average?: number
}

interface TmdbSeasonDetailsResponse extends TmdbSeason {
  _id?: string
  episodes?: TmdbEpisode[]
}

interface TmdbEpisode {
  id?: number
  name?: string
  overview?: string
  still_path?: string | null
  air_date?: string | null
  episode_number?: number
  runtime?: number | null
  vote_average?: number
}

interface TmdbWatchProvider {
  display_priority?: number
  logo_path?: string | null
  provider_id?: number
  provider_name?: string
}

interface TmdbWatchRegion {
  link?: string
  flatrate?: TmdbWatchProvider[]
  free?: TmdbWatchProvider[]
  ads?: TmdbWatchProvider[]
  rent?: TmdbWatchProvider[]
  buy?: TmdbWatchProvider[]
}

interface TmdbVideo {
  key?: string
  name?: string
  site?: string
  type?: string
  official?: boolean
}

interface TmdbImage {
  file_path?: string
  width?: number
  height?: number
  vote_average?: number
}

interface TmdbCredit {
  id?: number
  name?: string
  job?: string
  department?: string
  character?: string
  profile_path?: string | null
}

interface TmdbPersonResponse {
  id?: number
  name?: string
  biography?: string
  birthday?: string | null
  deathday?: string | null
  place_of_birth?: string | null
  known_for_department?: string | null
  profile_path?: string | null
  combined_credits?: {
    cast?: TmdbSearchResult[]
  }
}

interface TmdbGenreResponse {
  genres?: Array<{ id?: number; name?: string }>
}

const TMDB_API_BASE = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'
const TMDB_WEB_BASE = 'https://www.themoviedb.org'
const DEFAULT_WATCH_REGION = 'US'

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

export async function getMediaSummary(
  apiKey: string,
  kind: MediaKind,
  id: number,
  language: string,
): Promise<MediaSearchItem> {
  const endpoint = kind === 'movie' ? 'movie' : 'tv'
  const url = new URL(`${TMDB_API_BASE}/${endpoint}/${id}`)
  url.searchParams.set('language', language)

  const [response, genres] = await Promise.all([fetchTmdb(apiKey, url), listGenreMap(apiKey, kind, language)])
  const payload = (await response.json()) as TmdbDetailsResponse
  const item = toMediaSearchItem({ ...payload, media_type: kind }, genres)
  if (!item) throw new Error('TMDB summary response is missing required media fields.')
  return item
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
  watchRegion = DEFAULT_WATCH_REGION,
): Promise<MediaDetails> {
  const endpoint = kind === 'movie' ? 'movie' : 'tv'
  const url = new URL(`${TMDB_API_BASE}/${endpoint}/${id}`)
  url.searchParams.set('language', language)
  url.searchParams.set(
    'append_to_response',
    [
      'credits',
      'external_ids',
      'translations',
      'alternative_titles',
      'watch/providers',
      'videos',
      'images',
      'recommendations',
      'similar',
      kind === 'movie' ? 'release_dates' : 'content_ratings',
    ].join(','),
  )
  url.searchParams.set('include_image_language', `${language.slice(0, 2)},en,null`)

  const [response, genres] = await Promise.all([fetchTmdb(apiKey, url), listGenreMap(apiKey, kind, language)])
  const payload = (await response.json()) as TmdbDetailsResponse
  return toMediaDetails(kind, payload, genres, watchRegion)
}

export async function getSeasonDetails(
  apiKey: string,
  seriesId: number,
  seasonNumber: number,
  language: string,
): Promise<MediaSeasonDetails> {
  const url = new URL(`${TMDB_API_BASE}/tv/${seriesId}/season/${seasonNumber}`)
  url.searchParams.set('language', language)

  const response = await fetchTmdb(apiKey, url)
  const payload = (await response.json()) as TmdbSeasonDetailsResponse
  return toSeasonDetails(seriesId, payload)
}

export async function getPersonCredits(apiKey: string, id: number, language: string): Promise<MediaPersonCredits> {
  const url = new URL(`${TMDB_API_BASE}/person/${id}`)
  url.searchParams.set('language', language)
  url.searchParams.set('append_to_response', 'combined_credits')

  const [response, movieGenres, tvGenres] = await Promise.all([
    fetchTmdb(apiKey, url),
    listGenreMap(apiKey, 'movie', language),
    listGenreMap(apiKey, 'tv', language),
  ])
  const payload = (await response.json()) as TmdbPersonResponse

  if (!payload.id || !payload.name) {
    throw new Error('TMDB person response is missing required fields.')
  }

  const seen = new Set<string>()
  const results = (payload.combined_credits?.cast ?? [])
    .filter((item) => item.media_type === 'movie' || item.media_type === 'tv')
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
    .map((item) => toMediaSearchItem(item, item.media_type === 'movie' ? movieGenres : tvGenres))
    .filter((item): item is MediaSearchItem => item !== null)
    .filter((item) => {
      const key = `${item.kind}:${item.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  return {
    person: {
      id: payload.id,
      name: payload.name,
      biography: payload.biography?.trim() || null,
      birthday: payload.birthday ?? null,
      deathday: payload.deathday ?? null,
      placeOfBirth: payload.place_of_birth ?? null,
      knownForDepartment: payload.known_for_department ?? null,
      portraitUrl: payload.profile_path ? `${TMDB_IMAGE_BASE}/w342${payload.profile_path}` : null,
    },
    results,
  }
}

export async function getWatchClickouts(kind: MediaKind, id: number, region: string): Promise<Record<string, string>> {
  const path = kind === 'movie' ? 'movie' : 'tv'
  const url = new URL(`${TMDB_WEB_BASE}/${path}/${id}/remote/watch`)
  url.searchParams.set('translate', 'false')
  url.searchParams.set('locale', region)

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/html',
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: AbortSignal.timeout(3500),
    })
    if (!response.ok) return {}
    return Object.fromEntries(parseWatchClickouts(await response.text()))
  } catch {
    return {}
  }
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

function toMediaDetails(
  kind: MediaKind,
  item: TmdbDetailsResponse,
  genreMap: Map<number, string>,
  watchRegion: string,
  watchClickouts = new Map<string, string>(),
): MediaDetails {
  const searchItem = toMediaSearchItem(
    {
      ...item,
      media_type: kind,
    },
    genreMap,
  )

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
    tagline: item.tagline?.trim() || null,
    status: item.status ?? null,
    homepage: item.homepage?.trim() || null,
    runtime: typeof runtimeMinutes === 'number' && runtimeMinutes > 0 ? formatRuntime(runtimeMinutes) : null,
    language: item.original_language?.toUpperCase() ?? null,
    country: item.production_countries?.[0]?.name ?? item.origin_country?.[0] ?? null,
    director: directors[0] ?? null,
    writers,
    cast: toMediaCredits(item.credits?.cast ?? []),
    watch: toWatchInfo(item['watch/providers'], watchRegion, watchClickouts),
    videos: toMediaVideos(item.videos?.results ?? []),
    images: toMediaImages(item.images),
    recommendations: toMediaResults(kind, item.recommendations?.results ?? [], genreMap),
    similar: toMediaResults(kind, item.similar?.results ?? [], genreMap),
    seasons: kind === 'tv' ? toSeasonSummaries(item.seasons ?? []) : [],
    releaseInfo: kind === 'movie' ? toMovieReleaseInfo(item.release_dates) : toTvReleaseInfo(item.content_ratings),
    ids: {
      tmdb: String(searchItem.id),
      imdb: item.external_ids?.imdb_id ?? null,
      tvdb: item.external_ids?.tvdb_id ? String(item.external_ids.tvdb_id) : null,
    },
  }
}

function toSeasonDetails(seriesId: number, item: TmdbSeasonDetailsResponse): MediaSeasonDetails {
  const summary = toSeasonSummary(item)
  if (!summary) {
    throw new Error('TMDB season response is missing required fields.')
  }

  return {
    ...summary,
    seriesId,
    episodes: (item.episodes ?? [])
      .filter((episode): episode is TmdbEpisode & { id: number; episode_number: number; name: string } =>
        Boolean(episode.id && episode.episode_number && episode.name),
      )
      .map((episode) => ({
        id: episode.id,
        episodeNumber: episode.episode_number,
        title: episode.name,
        overview: episode.overview || '',
        stillUrl: episode.still_path ? `${TMDB_IMAGE_BASE}/w300${episode.still_path}` : null,
        airDate: episode.air_date ?? null,
        runtime: typeof episode.runtime === 'number' && episode.runtime > 0 ? formatRuntime(episode.runtime) : null,
        rating: typeof episode.vote_average === 'number' ? episode.vote_average : null,
      })),
  }
}

function toSeasonSummaries(seasons: TmdbSeason[]): MediaSeasonSummary[] {
  return seasons
    .map(toSeasonSummary)
    .filter((season): season is MediaSeasonSummary => season !== null)
    .sort((a, b) => a.seasonNumber - b.seasonNumber)
}

function toSeasonSummary(season: TmdbSeason): MediaSeasonSummary | null {
  if (!season.id || typeof season.season_number !== 'number' || !season.name) {
    return null
  }

  return {
    id: season.id,
    seasonNumber: season.season_number,
    title: season.name,
    overview: season.overview || '',
    posterUrl: season.poster_path ? `${TMDB_IMAGE_BASE}/w342${season.poster_path}` : null,
    airDate: season.air_date ?? null,
    episodeCount: typeof season.episode_count === 'number' ? season.episode_count : null,
    rating: typeof season.vote_average === 'number' ? season.vote_average : null,
  }
}

function toMediaResults(
  kind: MediaKind,
  results: TmdbSearchResult[],
  genreMap: Map<number, string>,
): MediaSearchItem[] {
  return results
    .map((item) => toMediaSearchItem({ ...item, media_type: kind }, genreMap))
    .filter((item): item is MediaSearchItem => item !== null)
    .slice(0, 12)
}

function toWatchInfo(
  payload: TmdbDetailsResponse['watch/providers'],
  region: string,
  clickouts: Map<string, string>,
): MediaWatchInfo | null {
  const item = payload?.results?.[region]
  if (!item?.link) return null

  const allGroups: MediaWatchProviderGroup[] = [
    { type: 'stream', providers: toWatchProviders(item.flatrate, clickouts) },
    { type: 'free', providers: toWatchProviders(item.free, clickouts) },
    { type: 'ads', providers: toWatchProviders(item.ads, clickouts) },
    { type: 'rent', providers: toWatchProviders(item.rent, clickouts) },
    { type: 'buy', providers: toWatchProviders(item.buy, clickouts) },
  ]
  const groups = allGroups.filter((group) => group.providers.length > 0)

  return groups.length > 0 ? { region, link: item.link, groups } : { region, link: item.link, groups: [] }
}

function toWatchProviders(providers: TmdbWatchProvider[] | undefined, clickouts: Map<string, string>) {
  return (providers ?? [])
    .filter((provider): provider is TmdbWatchProvider & { provider_id: number; provider_name: string } =>
      Boolean(provider.provider_id && provider.provider_name),
    )
    .sort((a, b) => (a.display_priority ?? 0) - (b.display_priority ?? 0))
    .slice(0, 8)
    .map((provider) => ({
      id: provider.provider_id,
      name: provider.provider_name,
      logoUrl: provider.logo_path ? `${TMDB_IMAGE_BASE}/w92${provider.logo_path}` : null,
      url: clickouts.get(normalizeProviderName(provider.provider_name)) ?? null,
    }))
}

function normalizeProviderName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function parseWatchClickouts(html: string): Map<string, string> {
  const clickouts = new Map<string, string>()
  const anchorPattern = /<a\b[^>]*href="([^"]+)"[^>]*title="(?:Watch|Rent|Buy|Stream)\s+[^"]+?\s+on\s+([^"]+)"[^>]*>/gi
  let match = anchorPattern.exec(html)

  while (match) {
    const [, rawUrl, rawProvider] = match
    const provider = decodeHtmlEntity(rawProvider ?? '').trim()
    const url = decodeHtmlEntity(rawUrl ?? '').trim()
    if (provider && url) {
      const key = normalizeProviderName(provider)
      if (!clickouts.has(key)) clickouts.set(key, url)
    }
    match = anchorPattern.exec(html)
  }

  return clickouts
}

function decodeHtmlEntity(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function toMediaVideos(videos: TmdbVideo[]): MediaVideo[] {
  return videos
    .filter((video): video is TmdbVideo & { key: string; name: string; site: string; type: string } =>
      Boolean(video.key && video.name && video.site && video.type),
    )
    .sort((a, b) => Number(Boolean(b.official)) - Number(Boolean(a.official)))
    .slice(0, 8)
    .map((video) => ({
      key: video.key,
      name: video.name,
      site: video.site,
      type: video.type,
      official: Boolean(video.official),
      url: getVideoUrl(video.site, video.key),
    }))
}

function getVideoUrl(site: string, key: string): string {
  if (site.toLowerCase() === 'youtube') return `https://www.youtube.com/watch?v=${encodeURIComponent(key)}`
  if (site.toLowerCase() === 'vimeo') return `https://vimeo.com/${encodeURIComponent(key)}`
  return `https://www.themoviedb.org/video/play?key=${encodeURIComponent(key)}`
}

function toMediaImages(images: TmdbDetailsResponse['images']): MediaImage[] {
  return [
    ...toTypedImages('backdrop', images?.backdrops ?? []),
    ...toTypedImages('poster', images?.posters ?? []),
    ...toTypedImages('logo', images?.logos ?? []),
  ].slice(0, 18)
}

function toTypedImages(type: MediaImage['type'], images: TmdbImage[]): MediaImage[] {
  return images
    .filter((image): image is TmdbImage & { file_path: string } => Boolean(image.file_path))
    .sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))
    .slice(0, type === 'backdrop' ? 8 : 5)
    .map((image) => ({
      type,
      url: `${TMDB_IMAGE_BASE}/${type === 'poster' ? 'w342' : 'w780'}${image.file_path}`,
      width: typeof image.width === 'number' ? image.width : null,
      height: typeof image.height === 'number' ? image.height : null,
    }))
}

function toMovieReleaseInfo(payload: TmdbDetailsResponse['release_dates']): MediaReleaseInfo | null {
  const region = payload?.results?.find((item) => item.iso_3166_1 === DEFAULT_WATCH_REGION) ?? payload?.results?.[0]
  const release = region?.release_dates?.find((item) => item.certification) ?? region?.release_dates?.[0]
  if (!release) return null
  return {
    certification: release.certification?.trim() || null,
    releaseDate: release.release_date ? release.release_date.slice(0, 10) : null,
  }
}

function toTvReleaseInfo(payload: TmdbDetailsResponse['content_ratings']): MediaReleaseInfo | null {
  const rating = payload?.results?.find((item) => item.iso_3166_1 === DEFAULT_WATCH_REGION) ?? payload?.results?.[0]
  if (!rating?.rating) return null
  return {
    certification: rating.rating,
    releaseDate: null,
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
    .filter((credit): credit is TmdbCredit & { id: number; name: string } => Boolean(credit.id && credit.name))
    .map((credit) => ({
      id: credit.id,
      name: credit.name,
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

export const tmdbMediaProvider: MediaProvider = {
  search: (source, query) => searchMedia(source.apiKey, query, source.language),
  trending: (source) => getTrendingMedia(source.apiKey, source.language),
  popular: (source, kind) => getPopularMedia(source.apiKey, kind, source.language),
  discover: (source, input) => discoverMedia(source.apiKey, { ...input, language: source.language }),
  genres: (source, kind) => listMediaGenres(source.apiKey, kind, source.language),
  summary: (source, kind, id) => getMediaSummary(source.apiKey, kind, id, source.language),
  details: (source, kind, id, watchRegion) => getMediaDetails(source.apiKey, kind, id, source.language, watchRegion),
  season: (source, id, seasonNumber) => getSeasonDetails(source.apiKey, id, seasonNumber, source.language),
  personCredits: (source, id) => getPersonCredits(source.apiKey, id, source.language),
  watchClickouts: (kind, id, watchRegion) => getWatchClickouts(kind, id, watchRegion),
  async probe(credentials) {
    const apiKey = credentials.apiKey
    if (!apiKey) throw new Error('TMDB API key is missing.')

    const response = await fetch(`${TMDB_API_BASE}/configuration`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    })
    if (!response.ok) throw new Error(`TMDB request failed: ${response.status}`)
  },
}
