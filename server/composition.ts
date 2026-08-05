import { downloaderGateways, downloadTaskGateways } from './adapters/gateways/downloaders'
import { indexerGateways } from './adapters/gateways/indexers'
import { createDpopTokenValidator, createOidcClient } from './adapters/gateways/oidc'
import { musicBrainzMusicProvider } from './adapters/music-catalogs/musicbrainz'
import { createMusicConnectorRegistry } from './adapters/music-connectors/registry'
import { openLibraryBookProvider } from './adapters/providers/books'
import { doubanLibraryImporter } from './adapters/providers/douban'
import { tmdbMediaProvider } from './adapters/providers/tmdb'
import { createConnectorLoginAttemptsRepo } from './adapters/repos/connector-login-attempts'
import { createConnectorSyncJobsRepo } from './adapters/repos/connector-sync-jobs'
import { createConnectorsRepo } from './adapters/repos/connectors'
import { createDownloadersRepo } from './adapters/repos/downloaders'
import { createIdentityRepo } from './adapters/repos/identity'
import { createIndexersRepo } from './adapters/repos/indexers'
import { createLibraryRepo } from './adapters/repos/library'
import {
  createDispatchLanesRepo,
  createDownloadRecordsRepo,
  createMediaSubscriptionsRepo,
} from './adapters/repos/media-downloads'
import { createMediaSourcesRepo } from './adapters/repos/media-sources'
import { createMusicCollectionsRepo } from './adapters/repos/music-collections'
import { createMusicDownloadKeysRepo } from './adapters/repos/music-download-keys'
import { createResourceApiRepo } from './adapters/repos/resource-api'
import { readConfig } from './config'
import { createDb } from './db/client'
import type { Env } from './env'
import { type TraceContext, traceCarrier } from './observability/trace'
import type { ConnectorSyncMessage } from './usecases/connectors'
import type { Deps } from './usecases/deps'

export function createDeps(env: Env, trace?: TraceContext): Deps {
  const db = createDb(env)
  const config = readConfig(env)
  return {
    identityRepo: createIdentityRepo(db),
    oidcClient: createOidcClient(config.oidc),
    dpopTokenValidator: createDpopTokenValidator(config),
    resourceApiRepo: createResourceApiRepo(db),
    libraryRepo: createLibraryRepo(db),
    connectorsRepo: createConnectorsRepo(db),
    connectorLoginAttemptsRepo: createConnectorLoginAttemptsRepo(db),
    connectorSyncJobsRepo: createConnectorSyncJobsRepo(db),
    connectorSyncQueue: {
      async enqueue(input) {
        const message: ConnectorSyncMessage = { type: 'connector_sync', ...input, ...traceCarrier(trace) }
        await env.MEDIA_DOWNLOAD_DISPATCH.send(message)
      },
    },
    musicCollectionsRepo: createMusicCollectionsRepo(db),
    musicDownloadKeysRepo: createMusicDownloadKeysRepo(db),
    mediaSubscriptionsRepo: createMediaSubscriptionsRepo(db),
    downloadRecordsRepo: createDownloadRecordsRepo(db),
    dispatchLanesRepo: createDispatchLanesRepo(db),
    downloadDispatchQueue: {
      async wake(laneKey, delaySeconds) {
        await env.MEDIA_DOWNLOAD_DISPATCH.send(
          { laneKey, ...traceCarrier(trace) },
          delaySeconds ? { delaySeconds } : undefined,
        )
      },
    },
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
    musicConnectors: createMusicConnectorRegistry(),
  }
}
