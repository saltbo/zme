import type { MediaKind, MediaSearchItem } from '@shared/types'

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

const TMDB_API_BASE = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

export async function searchMedia(apiKey: string, query: string): Promise<MediaSearchItem[]> {
  const url = new URL(`${TMDB_API_BASE}/search/multi`)
  url.searchParams.set('query', query)
  url.searchParams.set('language', 'zh-CN')
  url.searchParams.set('include_adult', 'false')

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`TMDB search failed: ${response.status}`)
  }

  const payload = (await response.json()) as TmdbSearchResponse
  return (payload.results ?? [])
    .filter((item) => item.media_type === 'movie' || item.media_type === 'tv')
    .map(toMediaSearchItem)
    .filter((item): item is MediaSearchItem => item !== null)
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
