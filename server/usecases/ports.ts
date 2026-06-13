import type {
  CreateDownloadInput,
  DownloaderInput,
  DownloaderKind,
  DownloadTaskPage,
  DownloadTaskStatus,
  DownloadTaskSummary,
  IndexerInput,
  IndexerKind,
  IndexerSearchItem,
  LibraryFilterKind,
  LibraryFilterStatus,
  LibraryKind,
  LibrarySourceKind,
  LibrarySourceSyncResult,
  MediaSourceInput,
  MediaSourceKind,
} from '@shared/types'

/** Parsed connection settings for an external service configured by the user. */
export interface ConnectorConfig {
  endpoint: string
  credentials: Record<string, string>
  options: Record<string, string>
}

export interface DownloaderGateway {
  /** Submits a download to the remote downloader. Throws on rejection. */
  submit(config: ConnectorConfig, input: CreateDownloadInput): Promise<void>
  /** Throws when the downloader is unreachable or misconfigured. */
  probe(config: ConnectorConfig): Promise<void>
}

export interface DownloadTaskOwner {
  downloaderId: string
  downloaderName: string
  downloaderKind: DownloaderKind
}

export interface ListDownloadTasksInput {
  status?: DownloadTaskStatus
  page: number
  pageSize: number
}

export type DownloadTaskEvent =
  | { event: 'snapshot'; data: { items: DownloadTaskSummary[] } }
  | { event: 'error'; data: { message: string } }

export interface DownloadTaskGateway {
  list(config: ConnectorConfig, owner: DownloadTaskOwner, input: ListDownloadTasksInput): Promise<DownloadTaskPage>
  stream(
    config: ConnectorConfig,
    owner: DownloadTaskOwner,
    signal: AbortSignal,
    emit: (event: DownloadTaskEvent) => void,
  ): Promise<void>
}

export interface IndexerSearchInput {
  query: string
  searchType?: 'search' | 'audiosearch' | 'booksearch'
  categories?: number[]
  title?: string
  year?: string
  aliases?: string[]
  kind?: 'movie' | 'tv'
  imdbId?: string
  tmdbId?: number
  tvdbId?: number
}

export type ResolvedDownloadSource = Pick<CreateDownloadInput, 'uri' | 'sourceType'>

export interface IndexerGateway {
  search(config: ConnectorConfig, input: IndexerSearchInput): Promise<IndexerSearchItem[]>
  /** Throws when the indexer is unreachable or misconfigured. */
  probe(config: ConnectorConfig): Promise<void>
  /** Whether the given download URL is served through this indexer instance. */
  matchesDownloadUrl(config: ConnectorConfig, uri: string): boolean
  /** Resolves an indexer proxy download URL to a direct source, null when unresolvable. */
  resolveDownloadSource(config: ConnectorConfig, uri: string): Promise<ResolvedDownloadSource | null>
}

export type ConnectorHealthStatus = 'unknown' | 'online' | 'offline'

export interface ConnectorHealthPatch {
  status: 'online' | 'offline'
  message: string
  checkedAt: string
}

export interface DownloaderRecord {
  id: string
  description: string | null
  kind: DownloaderKind
  config: ConnectorConfig
  enabled: boolean
  healthStatus: ConnectorHealthStatus
  healthMessage: string | null
  healthCheckedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface DownloadersRepo {
  list(userId: string): Promise<DownloaderRecord[]>
  get(userId: string, id: string): Promise<DownloaderRecord | null>
  getEnabled(userId: string, id: string): Promise<DownloaderRecord | null>
  listEnabled(userId: string): Promise<DownloaderRecord[]>
  create(userId: string, input: DownloaderInput): Promise<DownloaderRecord>
  update(userId: string, id: string, input: DownloaderInput): Promise<DownloaderRecord | null>
  delete(userId: string, id: string): Promise<boolean>
  setHealth(userId: string, id: string, health: ConnectorHealthPatch): Promise<DownloaderRecord | null>
}

export interface IndexerRecord {
  id: string
  description: string | null
  kind: IndexerKind
  config: ConnectorConfig
  enabled: boolean
  healthStatus: ConnectorHealthStatus
  healthMessage: string | null
  healthCheckedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface IndexersRepo {
  list(): Promise<IndexerRecord[]>
  get(id: string): Promise<IndexerRecord | null>
  listEnabled(): Promise<IndexerRecord[]>
  create(input: IndexerInput): Promise<IndexerRecord>
  update(id: string, input: IndexerInput): Promise<IndexerRecord | null>
  delete(id: string): Promise<boolean>
  setHealth(id: string, health: ConnectorHealthPatch): Promise<IndexerRecord | null>
}

export interface MediaSourceRecord {
  id: string
  description: string | null
  kind: MediaSourceKind
  credentials: Record<string, string>
  options: Record<string, string>
  enabled: boolean
  healthStatus: ConnectorHealthStatus
  healthMessage: string | null
  healthCheckedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface MediaSourcesRepo {
  list(): Promise<MediaSourceRecord[]>
  get(id: string): Promise<MediaSourceRecord | null>
  findEnabled(kind: MediaSourceKind): Promise<MediaSourceRecord | null>
  create(input: MediaSourceInput): Promise<MediaSourceRecord>
  update(id: string, input: MediaSourceInput): Promise<MediaSourceRecord | null>
  delete(id: string): Promise<boolean>
  setHealth(id: string, health: ConnectorHealthPatch): Promise<MediaSourceRecord | null>
}

export interface LibraryRecord {
  id: string
  userId: string | null
  mediaKey: string
  kind: LibraryKind
  tmdbId: number | null
  savedAt: string | null
  watchedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface LibraryStatePatch {
  savedAt: string | null
  watchedAt: string | null
  updatedAt: string
}

export interface LibraryRepo {
  get(userId: string, mediaKey: string): Promise<LibraryRecord | null>
  listAll(userId: string): Promise<LibraryRecord[]>
  listPage(
    userId: string,
    filter: { kind?: LibraryFilterKind; status?: LibraryFilterStatus },
    page: number,
    pageSize: number,
  ): Promise<{ rows: LibraryRecord[]; total: number }>
  insert(record: LibraryRecord): Promise<void>
  setStates(userId: string, mediaKey: string, patch: LibraryStatePatch): Promise<LibraryRecord | null>
  delete(userId: string, mediaKey: string): Promise<boolean>
}

export interface LibrarySourceRecord {
  id: string
  userId: string
  source: LibrarySourceKind
  profileId: string
  enabled: boolean
  lastSyncedAt: string | null
  lastError: string | null
  lastResult: LibrarySourceSyncResult | null
  createdAt: string
  updatedAt: string
}

export interface LibrarySourcesRepo {
  list(userId: string): Promise<LibrarySourceRecord[]>
  get(userId: string, source: LibrarySourceKind): Promise<LibrarySourceRecord | null>
  listEnabled(): Promise<LibrarySourceRecord[]>
  save(
    userId: string,
    source: LibrarySourceKind,
    input: { profileId: string; enabled: boolean },
  ): Promise<LibrarySourceRecord>
  delete(userId: string, source: LibrarySourceKind): Promise<boolean>
  markSynced(id: string, result: LibrarySourceSyncResult | null, error: string | null): Promise<void>
}

export interface UsersRepo {
  isInitialized(): Promise<boolean>
  /** Assigns library rows created before the first admin existed to that admin. */
  adoptOrphanLibraryItems(userId: string): Promise<void>
}
