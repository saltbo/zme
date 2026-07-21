import { downloaderGateways, downloadTaskGateways } from './adapters/gateways/downloaders'
import { indexerGateways } from './adapters/gateways/indexers'
import { openLibraryBookProvider } from './adapters/providers/books'
import { doubanLibraryImporter } from './adapters/providers/douban'
import { musicBrainzMusicProvider } from './adapters/providers/music'
import { neteaseMusicResourceResolver, neteasePlaylistConnector } from './adapters/providers/netease'
import { tmdbMediaProvider } from './adapters/providers/tmdb'
import { createConnectorLoginAttemptsRepo } from './adapters/repos/connector-login-attempts'
import { createConnectorsRepo } from './adapters/repos/connectors'
import { createDownloadersRepo } from './adapters/repos/downloaders'
import { createIndexersRepo } from './adapters/repos/indexers'
import { createLibraryRepo } from './adapters/repos/library'
import { createMediaSourcesRepo } from './adapters/repos/media-sources'
import { createMusicCollectionsRepo } from './adapters/repos/music-collections'
import { createMusicDownloadKeysRepo } from './adapters/repos/music-download-keys'
import { createUsersRepo } from './adapters/repos/users'
import { createDb } from './db/client'
import type { Env } from './env'
import type { Deps } from './usecases/deps'

export function createDeps(env: Env): Deps {
  const db = createDb(env)
  return {
    usersRepo: createUsersRepo(db),
    libraryRepo: createLibraryRepo(db),
    connectorsRepo: createConnectorsRepo(db),
    connectorLoginAttemptsRepo: createConnectorLoginAttemptsRepo(db),
    musicCollectionsRepo: createMusicCollectionsRepo(db),
    musicDownloadKeysRepo: createMusicDownloadKeysRepo(db),
    downloadersRepo: createDownloadersRepo(db),
    indexersRepo: createIndexersRepo(db),
    mediaSourcesRepo: createMediaSourcesRepo(db),
    downloaderGateways,
    downloadTaskGateways,
    indexerGateways,
    mediaProvider: tmdbMediaProvider,
    bookProvider: openLibraryBookProvider,
    musicProvider: musicBrainzMusicProvider,
    libraryImporters: { douban: doubanLibraryImporter },
    musicPlaylistConnectors: { netease: neteasePlaylistConnector },
    musicResourceResolvers: { netease: neteaseMusicResourceResolver },
  }
}
