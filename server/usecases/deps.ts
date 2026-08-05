import type { DownloaderKind, IndexerKind } from '@shared/types'
import type { DpopTokenValidator, IdentityRepo, OidcClient } from './identity'
import type {
  BookProvider,
  ConnectorLoginAttemptsRepo,
  ConnectorSyncJobsRepo,
  ConnectorSyncQueue,
  ConnectorsRepo,
  DispatchLanesRepo,
  DownloadDispatchQueue,
  DownloaderGateway,
  DownloadersRepo,
  DownloadRecordsRepo,
  DownloadTaskGateway,
  IndexerGateway,
  IndexersRepo,
  LibraryEntryImporter,
  LibraryRepo,
  MediaProvider,
  MediaSourcesRepo,
  MediaSubscriptionsRepo,
  MusicCollectionsRepo,
  MusicConnectorModule,
  MusicDownloadKeysRepo,
  MusicProvider,
  ResourceApiRepo,
} from './ports'

export interface Deps {
  identityRepo: IdentityRepo
  oidcClient: OidcClient
  dpopTokenValidator: DpopTokenValidator
  resourceApiRepo: ResourceApiRepo
  libraryRepo: LibraryRepo
  connectorsRepo: ConnectorsRepo
  connectorLoginAttemptsRepo: ConnectorLoginAttemptsRepo
  connectorSyncJobsRepo: ConnectorSyncJobsRepo
  connectorSyncQueue: ConnectorSyncQueue
  musicCollectionsRepo: MusicCollectionsRepo
  musicDownloadKeysRepo: MusicDownloadKeysRepo
  mediaSubscriptionsRepo: MediaSubscriptionsRepo
  downloadRecordsRepo: DownloadRecordsRepo
  dispatchLanesRepo: DispatchLanesRepo
  downloadDispatchQueue: DownloadDispatchQueue
  downloadersRepo: DownloadersRepo
  indexersRepo: IndexersRepo
  mediaSourcesRepo: MediaSourcesRepo
  downloaderGateways: Record<DownloaderKind, DownloaderGateway>
  downloadTaskGateways: Partial<Record<DownloaderKind, DownloadTaskGateway>>
  indexerGateways: Record<IndexerKind, IndexerGateway>
  mediaProvider: MediaProvider
  bookProvider: BookProvider
  musicProvider: MusicProvider
  libraryImporters: { douban: LibraryEntryImporter }
  musicConnectors: ReadonlyMap<string, MusicConnectorModule>
}
