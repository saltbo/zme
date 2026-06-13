import { downloaderGateways, downloadTaskGateways } from './adapters/gateways/downloaders'
import { indexerGateways } from './adapters/gateways/indexers'
import { openLibraryBookProvider } from './adapters/providers/books'
import { doubanLibraryImporter } from './adapters/providers/douban'
import { musicBrainzMusicProvider } from './adapters/providers/music'
import { tmdbMediaProvider } from './adapters/providers/tmdb'
import { createDownloadersRepo } from './adapters/repos/downloaders'
import { createIndexersRepo } from './adapters/repos/indexers'
import { createLibraryRepo } from './adapters/repos/library'
import { createLibrarySourcesRepo } from './adapters/repos/library-sources'
import { createMediaSourcesRepo } from './adapters/repos/media-sources'
import { createUsersRepo } from './adapters/repos/users'
import { createDb } from './db/client'
import type { Env } from './env'
import type { Deps } from './usecases/deps'

export function createDeps(env: Env): Deps {
  const db = createDb(env)
  return {
    usersRepo: createUsersRepo(db),
    libraryRepo: createLibraryRepo(db),
    librarySourcesRepo: createLibrarySourcesRepo(db),
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
  }
}
