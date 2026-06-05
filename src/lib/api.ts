import type {
  BookDetails,
  BookDiscoveryInput,
  BookSearchItem,
  CreateDownloadInput,
  CreateDownloadResult,
  DownloaderDetails,
  DownloaderHealth,
  DownloaderInput,
  DownloaderSummary,
  DownloadSearchTarget,
  DownloadTaskPage,
  IndexerDetails,
  IndexerHealth,
  IndexerInput,
  IndexerSearchItem,
  IndexerSummary,
  LibraryMediaInput,
  LibraryMediaItem,
  LibraryMediaPage,
  LibraryPageInput,
  LibraryResourceInput,
  LibrarySourceInput,
  LibrarySourceKind,
  LibrarySourceSummary,
  LibrarySourceSyncResult,
  LibraryStateItem,
  MediaDetails,
  MediaDiscoverInput,
  MediaDiscoverPage,
  MediaGenre,
  MediaKind,
  MediaPersonCredits,
  MediaSearchItem,
  MediaSeasonDetails,
  MediaSourceDetails,
  MediaSourceHealth,
  MediaSourceInput,
  MediaSourceSummary,
  MediaWatchClickouts,
  MusicAlbumDetails,
  MusicAlbumSearchItem,
  MusicDiscoveryInput,
  ResourcePage,
} from '@shared/types'

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function apiError(response: Response, fallbackMessage: string): Promise<ApiError> {
  try {
    const payload = (await response.clone().json()) as { error?: string; code?: string }
    return new ApiError(payload.error || fallbackMessage, response.status, payload.code)
  } catch {
    return new ApiError(fallbackMessage, response.status)
  }
}

async function apiRequest<T>(path: string, fallbackMessage: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  if (!response.ok) {
    throw await apiError(response, fallbackMessage)
  }

  return response.json() as Promise<T>
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const value = search.toString()
  return value ? `?${value}` : ''
}

function jsonBody(input: unknown): RequestInit {
  return {
    method: 'POST',
    body: JSON.stringify(input),
  }
}

export async function searchMedia(queryValue: string, language: string) {
  return apiRequest<{ results: MediaSearchItem[] }>(
    `/api/tmdb/search${query({ q: queryValue, language })}`,
    'Failed to search media.',
  )
}

export async function searchBooks(input: { query: string; page: number; pageSize?: number }) {
  return apiRequest<ResourcePage<BookSearchItem>>(
    `/api/books/search${query({ q: input.query, page: input.page, pageSize: input.pageSize })}`,
    'Failed to search books.',
  )
}

export async function discoverBooks(input: BookDiscoveryInput) {
  return apiRequest<ResourcePage<BookSearchItem>>(
    `/api/books/discover${query({
      mode: input.mode,
      period: input.period,
      subject: input.subject,
      page: input.page,
      pageSize: input.pageSize,
    })}`,
    'Failed to load books.',
  )
}

export async function getBookDetails(mediaKey: string) {
  return apiRequest<{ item: BookDetails }>(`/api/books/${encodeURIComponent(mediaKey)}`, 'Failed to load book details.')
}

export async function getSetupStatus() {
  return apiRequest<{ initialized: boolean }>('/api/setup/status', 'Failed to load setup status.')
}

export async function createInitialAdmin(input: { name: string; email: string; password: string }) {
  return apiRequest<{ user: unknown }>('/api/setup/admin', 'Failed to create administrator.', jsonBody(input))
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

export async function searchMusicAlbums(input: {
  query?: string
  artist?: string
  title?: string
  page: number
  pageSize?: number
}) {
  return apiRequest<ResourcePage<MusicAlbumSearchItem>>(
    `/api/music/search${query({
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
  return apiRequest<ResourcePage<MusicAlbumSearchItem>>(
    `/api/music/discover${query({
      mode: input.mode,
      range: input.range,
      chartType: input.chartType,
      genre: input.genre,
      releaseType: input.releaseType,
      year: /^(19|20)\d{2}$/.test(input.year ?? '') ? input.year : undefined,
      page: input.page,
      pageSize: input.pageSize,
    })}`,
    'Failed to load music.',
  )
}

export async function getMusicAlbumDetails(mediaKey: string) {
  return apiRequest<{ item: MusicAlbumDetails }>(
    `/api/music/details${query({ mediaKey })}`,
    'Failed to load music album details.',
  )
}

export async function searchIndexers(input: {
  query: string
  target?: MediaKind | DownloadSearchTarget
  title?: string
  aliases?: string[]
  creators?: string[]
  year?: string | null
  formats?: string[]
  narrator?: string | null
  kind?: MediaKind
  imdbId?: string | null
  tmdbId?: number | null
  tvdbId?: number | null
}) {
  return apiRequest<{ results: IndexerSearchItem[] }>(
    `/api/indexers/search${query({
      q: input.query,
      target: input.target,
      title: input.title,
      aliases: input.aliases?.join('|'),
      creators: input.creators?.join('|'),
      year: input.year ?? undefined,
      formats: input.formats?.join('|'),
      narrator: input.narrator ?? undefined,
      kind: input.kind,
      imdbId: input.imdbId ?? undefined,
      tmdbId: input.tmdbId ?? undefined,
      tvdbId: input.tvdbId ?? undefined,
    })}`,
    'Failed to search indexers.',
  )
}

export async function listLibrary(input: LibraryPageInput) {
  return apiRequest<LibraryMediaPage>(
    `/api/library${query({
      page: input.page,
      pageSize: input.pageSize,
      language: input.language,
      kind: input.kind && input.kind !== 'all' ? input.kind : undefined,
      status: input.status && input.status !== 'all' ? input.status : undefined,
    })}`,
    'Failed to load library.',
  )
}

export async function listLibraryStates() {
  return apiRequest<{ items: LibraryStateItem[] }>('/api/library/states', 'Failed to load library states.')
}

export async function saveLibraryItem(input: LibraryMediaInput) {
  return apiRequest<{ item: LibraryMediaItem }>(
    `/api/library/${input.kind}/${input.id}`,
    'Failed to save library item.',
    {
      method: 'PUT',
      body: JSON.stringify(input),
    },
  )
}

export async function saveLibraryResource(input: LibraryResourceInput) {
  return apiRequest<{ item: LibraryStateItem }>('/api/library/resources', 'Failed to save library item.', {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export async function removeLibraryItem(kind: MediaKind, id: number) {
  return apiRequest<{ kind: MediaKind; id: number }>(`/api/library/${kind}/${id}`, 'Failed to remove library item.', {
    method: 'DELETE',
  })
}

export async function removeLibraryResource(input: LibraryResourceInput) {
  return apiRequest<{ mediaKey: string; kind: LibraryResourceInput['kind'] }>(
    `/api/library/resources/${encodeURIComponent(input.mediaKey)}`,
    'Failed to remove library item.',
    {
      method: 'DELETE',
      body: JSON.stringify(input),
    },
  )
}

export async function markWatched(input: LibraryMediaInput) {
  return apiRequest<{ item: LibraryMediaItem }>(
    `/api/library/${input.kind}/${input.id}/watched`,
    'Failed to update watched status.',
    {
      method: 'PUT',
      body: JSON.stringify(input),
    },
  )
}

export async function unmarkWatched(kind: MediaKind, id: number) {
  return apiRequest<{ item: LibraryMediaItem | null; kind: MediaKind; id: number }>(
    `/api/library/${kind}/${id}/watched`,
    'Failed to update watched status.',
    {
      method: 'DELETE',
    },
  )
}

export async function listLibrarySources() {
  return apiRequest<{ items: LibrarySourceSummary[] }>('/api/library/sources', 'Failed to load library sources.')
}

export async function saveLibrarySource(source: LibrarySourceKind, input: LibrarySourceInput) {
  return apiRequest<{ item: LibrarySourceSummary }>(
    `/api/library/sources/${source}`,
    'Failed to save library source.',
    {
      method: 'PUT',
      body: JSON.stringify(input),
    },
  )
}

export async function deleteLibrarySource(source: LibrarySourceKind) {
  return apiRequest<{ source: LibrarySourceKind }>(
    `/api/library/sources/${source}`,
    'Failed to delete library source.',
    {
      method: 'DELETE',
    },
  )
}

export async function syncLibrarySource(source: LibrarySourceKind) {
  return apiRequest<{ result: LibrarySourceSyncResult }>(
    `/api/library/sources/${source}/sync`,
    'Failed to sync library source.',
    { method: 'POST' },
  )
}

export async function listIndexers() {
  return apiRequest<{ items: IndexerSummary[] }>('/api/indexers', 'Failed to load indexers.')
}

export async function createIndexer(input: IndexerInput) {
  return apiRequest<{ item: IndexerSummary }>('/api/indexers', 'Failed to create indexer.', jsonBody(input))
}

export async function getIndexer(id: string) {
  return apiRequest<{ item: IndexerDetails }>(`/api/indexers/${id}`, 'Failed to load indexer.')
}

export async function updateIndexer(id: string, input: IndexerInput) {
  return apiRequest<{ item: IndexerSummary }>(`/api/indexers/${id}`, 'Failed to update indexer.', {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export async function deleteIndexer(id: string) {
  return apiRequest<{ id: string }>(`/api/indexers/${id}`, 'Failed to delete indexer.', { method: 'DELETE' })
}

export async function checkIndexerHealth(id: string) {
  return apiRequest<{ health: IndexerHealth }>(`/api/indexers/${id}/health`, 'Failed to check indexer health.', {
    method: 'POST',
  })
}

export async function listMediaSources() {
  return apiRequest<{ items: MediaSourceSummary[] }>('/api/media-sources', 'Failed to load media sources.')
}

export async function createMediaSource(input: MediaSourceInput) {
  return apiRequest<{ item: MediaSourceSummary }>(
    '/api/media-sources',
    'Failed to create media source.',
    jsonBody(input),
  )
}

export async function getMediaSource(id: string) {
  return apiRequest<{ item: MediaSourceDetails }>(`/api/media-sources/${id}`, 'Failed to load media source.')
}

export async function updateMediaSource(id: string, input: MediaSourceInput) {
  return apiRequest<{ item: MediaSourceSummary }>(`/api/media-sources/${id}`, 'Failed to update media source.', {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export async function deleteMediaSource(id: string) {
  return apiRequest<{ id: string }>(`/api/media-sources/${id}`, 'Failed to delete media source.', {
    method: 'DELETE',
  })
}

export async function checkMediaSourceHealth(id: string) {
  return apiRequest<{ health: MediaSourceHealth }>(
    `/api/media-sources/${id}/health`,
    'Failed to check media source health.',
    { method: 'POST' },
  )
}

export async function listDownloaders() {
  return apiRequest<{ items: DownloaderSummary[] }>('/api/downloaders', 'Failed to load downloaders.')
}

export async function createDownloader(input: DownloaderInput) {
  return apiRequest<{ item: DownloaderSummary }>('/api/downloaders', 'Failed to create downloader.', jsonBody(input))
}

export async function getDownloader(id: string) {
  return apiRequest<{ item: DownloaderDetails }>(`/api/downloaders/${id}`, 'Failed to load downloader.')
}

export async function updateDownloader(id: string, input: DownloaderInput) {
  return apiRequest<{ item: DownloaderSummary }>(`/api/downloaders/${id}`, 'Failed to update downloader.', {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export async function deleteDownloader(id: string) {
  return apiRequest<{ id: string }>(`/api/downloaders/${id}`, 'Failed to delete downloader.', { method: 'DELETE' })
}

export async function checkDownloaderHealth(id: string) {
  return apiRequest<{ health: DownloaderHealth }>(
    `/api/downloaders/${id}/health`,
    'Failed to check downloader health.',
    { method: 'POST' },
  )
}

export async function listDownloadTasks(input: { status?: string; page: number; pageSize: number }) {
  return apiRequest<DownloadTaskPage>(
    `/api/downloads${query({ status: input.status, page: input.page, pageSize: input.pageSize })}`,
    'Failed to load downloads.',
  )
}

export function downloadTaskEventsUrl() {
  return '/api/downloads/events'
}

export async function createDownload(input: CreateDownloadInput) {
  return apiRequest<{ item: CreateDownloadResult }>('/api/downloads', 'Failed to submit download.', jsonBody(input))
}
