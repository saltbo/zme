import type { DownloaderKind, IndexerKind } from '@shared/types'
import type {
  BookProvider,
  ConnectorLoginAttemptsRepo,
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
  MusicDownloadKeysRepo,
  MusicPlaylistConnector,
  MusicProvider,
  MusicResourceResolver,
  UsersRepo,
} from './ports'

export interface Deps {
  usersRepo: UsersRepo
  libraryRepo: LibraryRepo
  connectorsRepo: ConnectorsRepo
  connectorLoginAttemptsRepo: ConnectorLoginAttemptsRepo
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
  musicPlaylistConnectors: { netease: MusicPlaylistConnector }
  musicResourceResolvers: { netease: MusicResourceResolver }
}
