import type {
  CreateDownloadInput,
  DownloaderKind,
  DownloadTaskPage,
  DownloadTaskStatus,
  DownloadTaskSummary,
  IndexerSearchItem,
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
