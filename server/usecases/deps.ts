import type { DownloaderKind, IndexerKind, LibrarySourceKind } from '@shared/types'
import type {
  BookProvider,
  DownloaderGateway,
  DownloadersRepo,
  DownloadTaskGateway,
  IndexerGateway,
  IndexersRepo,
  LibraryEntryImporter,
  LibraryRepo,
  LibrarySourcesRepo,
  MediaProvider,
  MediaSourcesRepo,
  MusicProvider,
  UsersRepo,
} from './ports'

export interface Deps {
  usersRepo: UsersRepo
  libraryRepo: LibraryRepo
  librarySourcesRepo: LibrarySourcesRepo
  downloadersRepo: DownloadersRepo
  indexersRepo: IndexersRepo
  mediaSourcesRepo: MediaSourcesRepo
  downloaderGateways: Record<DownloaderKind, DownloaderGateway>
  downloadTaskGateways: Partial<Record<DownloaderKind, DownloadTaskGateway>>
  indexerGateways: Record<IndexerKind, IndexerGateway>
  mediaProvider: MediaProvider
  bookProvider: BookProvider
  musicProvider: MusicProvider
  libraryImporters: Record<LibrarySourceKind, LibraryEntryImporter>
}
