export type MediaKind = 'movie' | 'tv'
export type LibraryKind = MediaKind | 'music' | 'book'

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
  genres: string[]
}

export interface BookCover {
  source: 'openlibrary'
  size: 'small' | 'medium' | 'large'
  url: string
}

export interface BookEditionCandidate {
  mediaKey: string
  openLibraryId: string
  title: string | null
  publishYear: number | null
  languages: string[]
  isbnCandidates: string[]
}

export interface BookSearchItem {
  mediaKey: string
  title: string
  authors: string[]
  languages: string[]
  firstPublishYear: number | null
  coverUrl: string | null
  isbnCandidates: string[]
  editionKeys: string[]
  aliases: string[]
}

export type BookDiscoveryMode = 'trending' | 'subject'
export type BookTrendingPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface BookDiscoveryInput {
  mode: BookDiscoveryMode
  period: BookTrendingPeriod
  subject?: string
  page: number
  pageSize: number
}

export interface ResourcePage<T> {
  results: T[]
  page: number
  totalPages: number
  totalResults: number
}

export interface BookDetails extends BookSearchItem {
  description: string | null
  covers: BookCover[]
  workKey: string | null
  editionKey: string | null
  editionCandidates: BookEditionCandidate[]
}

export type MediaDiscoverSort =
  | 'popularity.desc'
  | 'vote_average.desc'
  | 'primary_release_date.desc'
  | 'first_air_date.desc'

export interface MediaDiscoverInput {
  kind: MediaKind
  language: string
  page: number
  sortBy?: MediaDiscoverSort
  genreId?: number
  originCountry?: string
  year?: number
  ratingGte?: number
}

export interface MediaDiscoverPage {
  results: MediaSearchItem[]
  page: number
  totalPages: number
  totalResults: number
}

export interface MusicArtistCredit {
  id: string | null
  name: string
  joinPhrase: string
}

export interface MusicCoverArt {
  frontUrl: string | null
  frontThumbnailUrl: string | null
  backUrl: string | null
  backThumbnailUrl: string | null
}

export interface MusicAlbumSearchItem {
  mediaKey: string
  provider: 'musicbrainz'
  resourceType: 'release-group' | 'release'
  mbid: string
  releaseGroupMbid: string
  title: string
  artist: string | null
  artists: MusicArtistCredit[]
  firstReleaseDate: string | null
  releaseYear: string | null
  releaseDate: string | null
  country: string | null
  primaryType: string | null
  secondaryTypes: string[]
  disambiguation: string | null
  coverArt: MusicCoverArt
  scoreLabel?: string | null
}

export type MusicDiscoveryMode = 'popular' | 'genre'
export type MusicDiscoveryRange = 'week' | 'month' | 'year' | 'all_time'
export type MusicChartType = 'albums' | 'tracks'
export type MusicGenre = 'rock' | 'jazz' | 'electronic' | 'hip-hop' | 'classical' | 'pop' | 'metal'
export type MusicReleaseType = 'album' | 'ep' | 'single'

export interface MusicDiscoveryInput {
  mode: MusicDiscoveryMode
  range: MusicDiscoveryRange
  chartType: MusicChartType
  genre?: MusicGenre
  releaseType: MusicReleaseType
  year?: string
  page: number
  pageSize: number
}

export interface MusicAlias {
  name: string
  locale: string | null
  primary: boolean
  type: string | null
}

export interface MusicReleaseSummary {
  mediaKey: string
  mbid: string
  title: string
  date: string | null
  country: string | null
  status: string | null
  barcode: string | null
  formats: string[]
}

export interface MusicTrack {
  position: number
  number: string | null
  title: string
  lengthMs: number | null
  recordingMbid: string | null
  recordingMediaKey: string | null
  isrcs: string[]
}

export interface MusicMedium {
  position: number
  format: string | null
  title: string | null
  trackCount: number
  tracks: MusicTrack[]
}

export interface MusicAlbumDetails extends MusicAlbumSearchItem {
  detailMediaKey: string
  releaseMbid: string | null
  preferredRelease: MusicReleaseSummary | null
  releases: MusicReleaseSummary[]
  releaseDate: string | null
  country: string | null
  barcode: string | null
  aliases: MusicAlias[]
  formats: string[]
  media: MusicMedium[]
}

export interface MediaGenre {
  id: number
  name: string
}

export type LibraryMediaInput = Pick<MediaSearchItem, 'id' | 'kind'>

export interface LibraryResourceInput {
  mediaKey: string
  kind: LibraryKind
}

export interface LibraryMediaItem extends MediaSearchItem {
  mediaKey: string
  libraryItemId: string
  savedAt: string | null
  watchedAt: string | null
  updatedAt: string
}

export type LibraryFilterKind = LibraryKind | 'all'
export type LibraryFilterStatus = 'all' | 'unwatched' | 'watched'

export interface LibraryStateItem {
  mediaKey: string
  id: number | null
  kind: LibraryKind
  savedAt: string | null
  watchedAt: string | null
  updatedAt: string
}

export interface LibraryPageInput {
  page: number
  pageSize: number
  language?: string
  kind?: LibraryFilterKind
  status?: LibraryFilterStatus
}

export interface LibraryMediaPage {
  items: LibraryMediaItem[]
  page: number
  pageSize: number
  totalResults: number
  totalPages: number
}

export type LibrarySourceKind = 'douban'

export interface LibrarySourceInput {
  profileId: string
  enabled: boolean
}

export interface LibrarySourceSyncResult {
  scanned: number
  imported: number
  saved: number
  watched: number
  unmatched: number
}

export interface LibrarySourceSummary {
  id: string
  source: LibrarySourceKind
  profileId: string
  enabled: boolean
  lastSyncedAt: string | null
  lastError: string | null
  lastResult: LibrarySourceSyncResult | null
  createdAt: string
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
  id: number
  name: string
  role: string
  portraitUrl: string | null
}

export interface MediaPerson {
  id: number
  name: string
  biography: string | null
  birthday: string | null
  deathday: string | null
  placeOfBirth: string | null
  knownForDepartment: string | null
  portraitUrl: string | null
}

export interface MediaPersonCredits {
  person: MediaPerson
  results: MediaSearchItem[]
}

export interface MediaExternalIds {
  tmdb: string
  imdb: string | null
  tvdb: string | null
}

export type MediaWatchProviderGroupType = 'stream' | 'free' | 'ads' | 'rent' | 'buy'

export interface MediaWatchProvider {
  id: number
  name: string
  logoUrl: string | null
  url: string | null
}

export interface MediaWatchProviderGroup {
  type: MediaWatchProviderGroupType
  providers: MediaWatchProvider[]
}

export interface MediaWatchInfo {
  region: string
  link: string
  groups: MediaWatchProviderGroup[]
}

export interface MediaWatchClickouts {
  clickouts: Record<string, string>
}

export interface MediaVideo {
  name: string
  site: string
  type: string
  key: string
  official: boolean
  url: string
}

export interface MediaImage {
  type: 'backdrop' | 'poster' | 'logo'
  url: string
  width: number | null
  height: number | null
}

export interface MediaReleaseInfo {
  certification: string | null
  releaseDate: string | null
}

export interface MediaSeasonSummary {
  id: number
  seasonNumber: number
  title: string
  overview: string
  posterUrl: string | null
  airDate: string | null
  episodeCount: number | null
  rating: number | null
}

export interface MediaEpisode {
  id: number
  episodeNumber: number
  title: string
  overview: string
  stillUrl: string | null
  airDate: string | null
  runtime: string | null
  rating: number | null
}

export interface MediaSeasonDetails extends MediaSeasonSummary {
  seriesId: number
  episodes: MediaEpisode[]
}

export interface MediaDetails extends MediaSearchItem {
  aliases: string[]
  genres: string[]
  tagline: string | null
  status: string | null
  homepage: string | null
  runtime: string | null
  language: string | null
  country: string | null
  director: string | null
  writers: string[]
  cast: MediaCredit[]
  watch: MediaWatchInfo | null
  videos: MediaVideo[]
  images: MediaImage[]
  recommendations: MediaSearchItem[]
  similar: MediaSearchItem[]
  seasons: MediaSeasonSummary[]
  releaseInfo: MediaReleaseInfo | null
  ids: MediaExternalIds
}

export type DownloadSearchTarget = 'music' | 'ebook' | 'audiobook'

export interface IndexerSearchItem {
  id: string
  downloadTarget: DownloadSearchTarget | null
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
  categoryIds: number[]
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
  | 'pausing'
  | 'paused'
  | 'uploading'
  | 'canceling'
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
