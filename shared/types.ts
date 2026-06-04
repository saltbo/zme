export type MediaKind = 'movie' | 'tv'

export interface MediaSearchItem {
  id: number
  kind: MediaKind
  title: string
  originalTitle: string
  overview: string
  posterUrl: string | null
  backdropUrl: string | null
  releaseYear: string | null
  rating: number | null
}

export interface MediaCredit {
  name: string
  role: string
  portraitUrl: string | null
}

export interface MediaExternalIds {
  tmdb: string
  imdb: string | null
  tvdb: string | null
}

export interface MediaDetails extends MediaSearchItem {
  genres: string[]
  runtime: string | null
  language: string | null
  country: string | null
  director: string | null
  writers: string[]
  cast: MediaCredit[]
  ids: MediaExternalIds
}

export interface IndexerSearchItem {
  id: string
  title: string
  indexer: string
  size: number | null
  seeders: number | null
  leechers: number | null
  publishDate: string | null
  downloadUrl: string | null
  magnetUrl: string | null
  infoHash: string | null
}

export interface SaveTarget {
  url: string
}
