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

export type FavoriteMediaInput = MediaSearchItem

export interface FavoriteMediaItem extends MediaSearchItem {
  favoriteId: string
  favoritedAt: string
  updatedAt: string
}

export type UserRole = 'admin' | 'user'

export interface AppUser {
  id: string
  name: string
  email: string
  role: UserRole
  banned: boolean
  createdAt: string
  updatedAt: string
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
  aliases: string[]
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
  fileName: string | null
  indexer: string
  size: number | null
  seeders: number | null
  leechers: number | null
  files: number | null
  protocol: string | null
  publishDate: string | null
  downloadUrl: string | null
  magnetUrl: string | null
  infoUrl: string | null
  infoHash: string | null
  categories: string[]
  indexerFlags: string[]
  imdbId: number | null
  tmdbId: number | null
  tvdbId: number | null
}

export type IndexerKind = 'prowlarr'

export interface IndexerSummary {
  id: string
  description: string | null
  kind: IndexerKind
  endpoint: string
  enabled: boolean
  healthStatus: 'unknown' | 'online' | 'offline'
  healthMessage: string | null
  healthCheckedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface IndexerDetails extends IndexerSummary {
  credentials: Record<string, string>
  options: Record<string, string>
}

export interface IndexerHealth {
  status: 'online' | 'offline'
  message: string
  checkedAt: string
}

export interface IndexerInput {
  description?: string
  kind: IndexerKind
  endpoint: string
  credentials: Record<string, string>
  options: Record<string, string>
  enabled: boolean
}

export type MediaSourceKind = 'tmdb'

export interface MediaSourceSummary {
  id: string
  description: string | null
  kind: MediaSourceKind
  enabled: boolean
  healthStatus: 'unknown' | 'online' | 'offline'
  healthMessage: string | null
  healthCheckedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface MediaSourceDetails extends MediaSourceSummary {
  credentials: Record<string, string>
  options: Record<string, string>
}

export interface MediaSourceHealth {
  status: 'online' | 'offline'
  message: string
  checkedAt: string
}

export interface MediaSourceInput {
  description?: string
  kind: MediaSourceKind
  credentials: Record<string, string>
  options: Record<string, string>
  enabled: boolean
}

export interface SaveTarget {
  url: string
}

export type DownloaderKind = 'zpan' | 'qbittorrent' | 'transmission' | 'aria2'

export interface DownloaderSummary {
  id: string
  description: string | null
  kind: DownloaderKind
  endpoint: string
  enabled: boolean
  healthStatus: 'unknown' | 'online' | 'offline'
  healthMessage: string | null
  healthCheckedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface DownloaderDetails extends DownloaderSummary {
  credentials: Record<string, string>
  options: Record<string, string>
}

export interface DownloaderHealth {
  status: 'online' | 'offline'
  message: string
  checkedAt: string
}

export interface DownloaderInput {
  description?: string
  kind: DownloaderKind
  endpoint: string
  credentials: Record<string, string>
  options: Record<string, string>
  enabled: boolean
}

export type DownloadTaskStatus =
  | 'queued'
  | 'assigned'
  | 'running'
  | 'billing_paused'
  | 'uploading'
  | 'completed'
  | 'failed'
  | 'canceled'

export interface DownloadTaskSummary {
  id: string
  downloaderId: string
  downloaderName: string
  downloaderKind: DownloaderKind
  sourceType: 'http' | 'magnet' | 'torrent_url'
  sourceUri: string
  name: string
  targetFolder: string
  category: string | null
  tags: string[]
  status: DownloadTaskStatus
  downloadedBytes: number
  storageUploadedBytes: number
  totalBytes: number | null
  downloadBps: number
  storageUploadBps: number
  errorMessage: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface DownloadTaskPage {
  items: DownloadTaskSummary[]
  total: number
  page: number
  pageSize: number
}

export interface CreateDownloadInput {
  downloaderId: string
  uri: string
  sourceType: 'magnet' | 'torrent_url'
  title?: string
  category?: string
  tags?: string[]
}

export interface CreateDownloadResult {
  downloaderId: string
  status: 'submitted'
}
