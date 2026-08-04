import type { AppConfig } from '@server/config'
import { API_VERSION } from '@server/config'

const secured = (scope: string) => [{ oidcSession: [] }, { realmrootOidc: [scope] }]
const parameters = [{ $ref: '#/components/parameters/ApiVersion' }]
const errors = {
  '400': { $ref: '#/components/responses/BadRequest' },
  '401': { $ref: '#/components/responses/Unauthorized' },
  '403': { $ref: '#/components/responses/Forbidden' },
  '404': { $ref: '#/components/responses/NotFound' },
  '409': { $ref: '#/components/responses/Conflict' },
  '422': { $ref: '#/components/responses/ValidationError' },
  '429': { $ref: '#/components/responses/TooManyRequests' },
  '502': { $ref: '#/components/responses/BadGateway' },
  '503': { $ref: '#/components/responses/ServiceUnavailable' },
  '500': { $ref: '#/components/responses/InternalError' },
}
const publicErrors = {
  '400': { $ref: '#/components/responses/PublicBadRequest' },
  '500': { $ref: '#/components/responses/PublicInternalError' },
}
const operationSummaries: Record<string, string> = {
  listMedia: 'Search the configured media catalog',
  listReleaseSearchJobs: 'List release-search jobs owned by the caller',
  createReleaseSearchJob: 'Create and run a release-search job',
  getReleaseSearchJob: 'Get an owned release-search job',
  listReleaseSearchResults: 'List candidates produced by a release-search job',
  getReleaseSearchResult: 'Get an owned release-search candidate',
  listDownloadTasks: 'List download tasks owned by the caller',
  createDownloadTask: 'Create a download task for a release candidate',
  getDownloadTask: 'Get an owned download task',
  listDownloadDestinations: 'List safe download destinations available to the caller',
}

export function openapiDocument(config: AppConfig) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'ZME Resource API',
      version: API_VERSION,
      license: { name: 'AGPL-3.0-only', identifier: 'AGPL-3.0-only' },
      description:
        'Resource-oriented media discovery, release-search job, and download-task API. Local roles and resource ownership further restrict every operation.',
    },
    servers: [{ url: config.resourceUrl }],
    tags: [
      { name: 'media-catalog', description: 'Search the configured media metadata catalog.' },
      { name: 'release-acquisition', description: 'Search releases and submit selected candidates to downloaders.' },
      { name: 'library', description: 'Operate the signed-in user library and music collections.' },
      { name: 'connectors', description: 'Operate signed-in user connector projections.' },
      { name: 'configuration', description: 'Administrator-only indexer, source, and downloader configuration.' },
      { name: 'downloads', description: 'Operate browser-session download records and streams.' },
      { name: 'system', description: 'Public service metadata and health.' },
    ],
    paths: {
      ...sessionApiPaths(),
      '/media': {
        get: {
          operationId: 'listMedia',
          summary: operationSummaries.listMedia,
          tags: ['media-catalog'],
          security: secured('media:read'),
          parameters: [
            ...parameters,
            { name: 'query', in: 'query', required: true, schema: { type: 'string', minLength: 1 } },
            { name: 'kind', in: 'query', schema: { type: 'string', enum: ['movie', 'tv'] } },
            { name: 'language', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': success('#/components/schemas/MediaCollection'), ...errors },
        },
      },
      '/release-search-jobs': {
        get: listOperation(
          'listReleaseSearchJobs',
          'release-search-jobs:read',
          '#/components/schemas/ReleaseSearchJobCollection',
        ),
        post: createOperation(
          'createReleaseSearchJob',
          'release-search-jobs:write',
          '#/components/schemas/CreateReleaseSearchJob',
          '#/components/schemas/ReleaseSearchJob',
        ),
      },
      '/release-search-jobs/{releaseSearchJobId}': {
        get: getOperation(
          'getReleaseSearchJob',
          'release-search-jobs:read',
          'releaseSearchJobId',
          '#/components/schemas/ReleaseSearchJob',
        ),
      },
      '/release-search-jobs/{releaseSearchJobId}/results': {
        get: childListOperation(
          'listReleaseSearchResults',
          'release-search-jobs:read',
          'releaseSearchJobId',
          '#/components/schemas/ReleaseSearchResultCollection',
        ),
      },
      '/release-search-results/{releaseSearchResultId}': {
        get: getOperation(
          'getReleaseSearchResult',
          'release-search-jobs:read',
          'releaseSearchResultId',
          '#/components/schemas/ReleaseSearchResult',
        ),
      },
      '/download-tasks': {
        get: listOperation('listDownloadTasks', 'download-tasks:read', '#/components/schemas/DownloadTaskCollection'),
        post: createOperation(
          'createDownloadTask',
          'download-tasks:write',
          '#/components/schemas/CreateDownloadTask',
          '#/components/schemas/DownloadTask',
        ),
      },
      '/download-tasks/{downloadTaskId}': {
        get: getOperation(
          'getDownloadTask',
          'download-tasks:read',
          'downloadTaskId',
          '#/components/schemas/DownloadTask',
        ),
      },
      '/download-destinations': {
        get: {
          operationId: 'listDownloadDestinations',
          summary: operationSummaries.listDownloadDestinations,
          tags: ['release-acquisition'],
          security: secured('download-destinations:read'),
          parameters,
          responses: { '200': success('#/components/schemas/DownloadDestinationCollection'), ...errors },
        },
      },
    },
    components: {
      securitySchemes: {
        oidcSession: {
          type: 'apiKey',
          in: 'cookie',
          name: '__Host-zme_session',
          description: 'Secure local session established by external OIDC.',
        },
        realmrootOidc: {
          type: 'openIdConnect',
          openIdConnectUrl: `${config.oidc.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
          description: 'Realmroot DPoP-bound resource token. Bearer tokens are rejected.',
        },
        musicDownloadKey: {
          type: 'apiKey',
          in: 'query',
          name: 'key',
          description: 'Short-lived, single-purpose signed music content key.',
        },
      },
      parameters: {
        ApiVersion: {
          name: 'API-Version',
          in: 'header',
          required: true,
          schema: { type: 'string', const: API_VERSION },
        },
        ApiVersionQuery: {
          name: 'apiVersion',
          in: 'query',
          required: true,
          schema: { type: 'string', const: API_VERSION },
        },
        IdempotencyKey: {
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
          schema: { type: 'string', minLength: 1, maxLength: 200 },
        },
        IfMatch: {
          name: 'If-Match',
          in: 'header',
          required: true,
          description: 'Strong ETag returned by the most recent read or write of this resource.',
          schema: { type: 'string', pattern: '^".+"$' },
        },
        Page: { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
        PageSize: { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
      },
      headers: {
        RequestId: { schema: { type: 'string', format: 'uuid' } },
        ApiVersion: { schema: { type: 'string', const: API_VERSION } },
        Location: { schema: { type: 'string', format: 'uri' } },
        Link: { schema: { type: 'string' } },
        ETag: { schema: { type: 'string', pattern: '^".+"$' } },
        WwwAuthenticate: {
          description: 'DPoP challenge or error for token/proof/scope failures.',
          schema: { type: 'string', pattern: '^DPoP(?: |$)' },
        },
      },
      responses: {
        BadRequest: problemResponse('Invalid protocol request'),
        Unauthorized: problemResponse('Authentication required', true),
        Forbidden: problemResponse('Authorization denied', true),
        NotFound: problemResponse('Resource not found'),
        Conflict: problemResponse('Resource conflict'),
        ValidationError: problemResponse('Request validation failed'),
        PreconditionFailed: problemResponse('The resource changed after it was read'),
        PreconditionRequired: problemResponse('If-Match is required for this mutation'),
        TooManyRequests: problemResponse('The upstream or application rate limit was exceeded'),
        BadGateway: problemResponse('An upstream service could not complete the request'),
        ServiceUnavailable: problemResponse('A required service is not configured or is unavailable'),
        InternalError: problemResponse('Unexpected server failure'),
        PublicBadRequest: problemResponse('Malformed public request', false, false),
        PublicInternalError: problemResponse('Unexpected server failure', false, false),
      },
      schemas: schemas(),
    },
  }
}

type SessionOperation = readonly [
  method: 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head',
  path: string,
  operationId: string,
  summary: string,
  tag: 'media-catalog' | 'library' | 'connectors' | 'configuration' | 'downloads' | 'system',
  policy?: 'admin' | 'signed-key' | 'public',
]

const sessionOperations: SessionOperation[] = [
  ['get', '/', 'getResourceServer', 'Get Resource Server discovery metadata', 'system', 'public'],
  ['get', '/health', 'getServiceHealth', 'Get service health', 'system', 'public'],
  ['get', '/openapi.json', 'getOpenApiDocument', 'Get the complete OpenAPI document', 'system', 'public'],
  [
    'get',
    '/music/tracks/{id}/content',
    'getSignedMusicContent',
    'Read signed music track content',
    'downloads',
    'signed-key',
  ],
  [
    'head',
    '/music/tracks/{id}/content',
    'headSignedMusicContent',
    'Inspect signed music track content',
    'downloads',
    'signed-key',
  ],
  ['get', '/media-trends', 'listMediaTrends', 'List trending media', 'media-catalog'],
  ['get', '/popular-media', 'listPopularMedia', 'List popular media', 'media-catalog'],
  ['get', '/media-recommendations', 'listMediaRecommendations', 'List media recommendations', 'media-catalog'],
  ['get', '/media-genres', 'listMediaGenres', 'List media genres', 'media-catalog'],
  ['get', '/people/{id}/credits', 'getPersonCredits', 'Get person credits', 'media-catalog'],
  ['get', '/movies/{id}/watch-clickouts', 'getMovieWatchClickouts', 'Get movie watch links', 'media-catalog'],
  ['get', '/series/{id}/watch-clickouts', 'getSeriesWatchClickouts', 'Get series watch links', 'media-catalog'],
  ['get', '/movies/{id}', 'getMovie', 'Get a movie', 'media-catalog'],
  ['get', '/series/{id}/seasons/{seasonNumber}', 'getSeriesSeason', 'Get a series season', 'media-catalog'],
  ['get', '/series/{id}', 'getSeries', 'Get a series', 'media-catalog'],
  ['get', '/books', 'listBooks', 'Search books', 'media-catalog'],
  ['get', '/book-recommendations', 'listBookRecommendations', 'List book recommendations', 'media-catalog'],
  ['get', '/books/{mediaKey}', 'getBook', 'Get a book', 'media-catalog'],
  ['get', '/music', 'listMusic', 'Search music', 'media-catalog'],
  ['get', '/music-recommendations', 'listMusicRecommendations', 'List music recommendations', 'media-catalog'],
  ['get', '/music/{mediaKey}', 'getMusic', 'Get music details', 'media-catalog'],
  ['post', '/music-download-tasks', 'createMusicDownloadTask', 'Create a music download task', 'downloads'],
  ['get', '/library', 'listLibraryResources', 'List library resources', 'library'],
  ['get', '/library/states', 'listLibraryStates', 'List library resource states', 'library'],
  ['put', '/library/resources', 'putLibraryResource', 'Create or replace a library resource', 'library'],
  ['delete', '/library/resources/{mediaKey}', 'deleteLibraryResource', 'Delete a library resource', 'library'],
  ['get', '/library/music/collections', 'listMusicCollections', 'List music collections', 'library'],
  ['get', '/library/music/collections/{id}', 'getMusicCollection', 'Get a music collection', 'library'],
  [
    'put',
    '/library/music/collections/{id}/subscription',
    'putMusicCollectionSubscription',
    'Replace a collection subscription',
    'library',
  ],
  [
    'delete',
    '/library/music/collections/{id}/subscription',
    'deleteMusicCollectionSubscription',
    'Delete a collection subscription',
    'library',
  ],
  ['delete', '/library/music/collections/{id}', 'deleteMusicCollection', 'Delete a music collection', 'library'],
  ['post', '/library/music/albums', 'createLibraryMusicAlbum', 'Create a library music album', 'library'],
  ['get', '/library/music/favorites', 'listFavoriteMusicTracks', 'List favorite music tracks', 'library'],
  ['put', '/library/music/favorites', 'putFavoriteMusicTrack', 'Create or replace a favorite track', 'library'],
  ['get', '/connectors/providers', 'listConnectorProviders', 'List connector providers', 'connectors'],
  ['get', '/connectors', 'listConnectors', 'List connectors', 'connectors'],
  ['post', '/connectors/douban', 'createDoubanConnector', 'Create a Douban connector', 'connectors'],
  [
    'post',
    '/connector-login-attempts',
    'createConnectorLoginAttempt',
    'Create a connector login attempt',
    'connectors',
  ],
  ['get', '/connector-login-attempts/{id}', 'getConnectorLoginAttempt', 'Get a connector login attempt', 'connectors'],
  [
    'put',
    '/connector-login-attempts/{id}/response',
    'putConnectorLoginResponse',
    'Replace a connector login challenge response',
    'connectors',
  ],
  ['patch', '/connectors/{id}', 'updateConnector', 'Update a connector', 'connectors'],
  ['delete', '/connectors/{id}', 'deleteConnector', 'Delete a connector', 'connectors'],
  ['post', '/connector-sync-jobs', 'createConnectorSyncJob', 'Create a connector sync job', 'connectors'],
  ['get', '/connector-sync-jobs/{id}', 'getConnectorSyncJob', 'Get a connector sync job', 'connectors'],
  ['get', '/connectors/{id}/playlists', 'listConnectorPlaylists', 'List connector playlists', 'connectors'],
  ['put', '/connectors/{id}/playlists', 'putConnectorPlaylists', 'Replace selected connector playlists', 'connectors'],
  [
    'get',
    '/release-candidates',
    'listReleaseCandidates',
    'Search ephemeral release candidates',
    'configuration',
    'admin',
  ],
  ['get', '/indexers', 'listIndexers', 'List indexers', 'configuration', 'admin'],
  ['get', '/indexers/{id}', 'getIndexer', 'Get an indexer', 'configuration', 'admin'],
  ['post', '/indexers', 'createIndexer', 'Create an indexer', 'configuration', 'admin'],
  ['patch', '/indexers/{id}', 'updateIndexer', 'Update an indexer', 'configuration', 'admin'],
  ['delete', '/indexers/{id}', 'deleteIndexer', 'Delete an indexer', 'configuration', 'admin'],
  ['get', '/indexers/{id}/health', 'getIndexerHealth', 'Get the latest indexer health', 'configuration', 'admin'],
  ['put', '/indexers/{id}/health', 'putIndexerHealth', 'Refresh the latest indexer health', 'configuration', 'admin'],
  ['get', '/media-sources', 'listMediaSources', 'List media sources', 'configuration', 'admin'],
  ['get', '/media-sources/{id}', 'getMediaSource', 'Get a media source', 'configuration', 'admin'],
  ['post', '/media-sources', 'createMediaSource', 'Create a media source', 'configuration', 'admin'],
  ['patch', '/media-sources/{id}', 'updateMediaSource', 'Update a media source', 'configuration', 'admin'],
  ['delete', '/media-sources/{id}', 'deleteMediaSource', 'Delete a media source', 'configuration', 'admin'],
  [
    'get',
    '/media-sources/{id}/health',
    'getMediaSourceHealth',
    'Get the latest media-source health',
    'configuration',
    'admin',
  ],
  [
    'put',
    '/media-sources/{id}/health',
    'putMediaSourceHealth',
    'Refresh the latest media-source health',
    'configuration',
    'admin',
  ],
  ['get', '/downloaders', 'listDownloaders', 'List downloaders', 'configuration'],
  ['get', '/downloaders/{id}', 'getDownloader', 'Get a downloader', 'configuration'],
  ['post', '/downloaders', 'createDownloader', 'Create a downloader', 'configuration'],
  ['patch', '/downloaders/{id}', 'updateDownloader', 'Update a downloader', 'configuration'],
  ['delete', '/downloaders/{id}', 'deleteDownloader', 'Delete a downloader', 'configuration'],
  ['get', '/downloaders/{id}/health', 'getDownloaderHealth', 'Get the latest downloader health', 'configuration'],
  ['put', '/downloaders/{id}/health', 'putDownloaderHealth', 'Refresh the latest downloader health', 'configuration'],
  ['get', '/downloads', 'listBrowserDownloads', 'List browser download records', 'downloads'],
  ['get', '/downloads/events', 'streamDownloadEvents', 'Stream browser download events', 'downloads'],
  ['post', '/downloads', 'createBrowserDownload', 'Create a browser download', 'downloads'],
]

function sessionApiPaths() {
  const paths: Record<string, Record<string, object>> = {}
  for (const [method, path, operationId, summary, tag, policy] of sessionOperations) {
    const pathParameters = [...path.matchAll(/\{([^}]+)\}/g)].map((match) =>
      sessionPathParameter(operationId, match[1] as string),
    )
    const security =
      policy === 'public' ? [] : policy === 'signed-key' ? [{ musicDownloadKey: [] }] : [{ oidcSession: [] }]
    const successStatus = sessionSuccessStatus(operationId, method)
    const noContent = successStatus === '204'
    const optimisticResource = /^\/(connectors|downloaders|indexers|media-sources)\/\{id\}$/.test(path)
    const optimisticMutation = optimisticResource && (method === 'patch' || method === 'delete')
    const operation: Record<string, unknown> = {
      operationId,
      summary,
      tags: [tag],
      security,
      parameters: [
        ...(policy === 'public'
          ? []
          : policy === 'signed-key'
            ? [{ $ref: '#/components/parameters/ApiVersionQuery' }]
            : operationId === 'streamDownloadEvents'
              ? [{ $ref: '#/components/parameters/ApiVersionQuery' }]
              : parameters),
        ...pathParameters,
        ...sessionQueryParameters(operationId),
        ...(operationId === 'createConnectorSyncJob' ? [{ $ref: '#/components/parameters/IdempotencyKey' }] : []),
        ...(optimisticMutation ? [{ $ref: '#/components/parameters/IfMatch' }] : []),
      ],
      responses: {
        [successStatus]: noContent
          ? { description: 'Resource deleted', headers: headers() }
          : sessionSuccessResponse(
              operationId,
              optimisticResource || (method === 'post' && /^\/(downloaders|indexers|media-sources)$/.test(path)),
            ),
        ...(optimisticMutation
          ? {
              '412': { $ref: '#/components/responses/PreconditionFailed' },
              '428': { $ref: '#/components/responses/PreconditionRequired' },
            }
          : {}),
        ...(policy === 'public' ? publicErrors : errors),
      },
    }
    if (policy === 'admin') operation['x-zme-local-role'] = 'admin'
    if (operationId === 'listMusic') {
      operation.description = 'At least one of q, artist, or title is required.'
      operation['x-zme-query-constraint'] = { atLeastOne: ['q', 'artist', 'title'] }
    }
    if (operationId === 'getSignedMusicContent') {
      ;(operation.responses as Record<string, object>)['307'] = musicRedirectResponse()
    }
    const requestSchema = sessionRequestSchema(operationId)
    if (requestSchema) {
      operation.requestBody = { required: true, content: json({ $ref: requestSchema }) }
    }
    paths[path] ??= {}
    paths[path][method] = operation
  }
  return paths
}

function sessionSuccessStatus(operationId: string, method: SessionOperation[0]) {
  const overrides: Record<string, string> = {
    createMusicDownloadTask: '202',
    createDoubanConnector: '200',
    putConnectorPlaylists: '202',
    putMusicCollectionSubscription: '202',
    deleteConnector: '204',
    deleteIndexer: '204',
    deleteMediaSource: '204',
    deleteDownloader: '204',
  }
  return overrides[operationId] ?? (method === 'post' ? '201' : '200')
}

const sessionResponseSchemaByOperation: Record<string, string> = {
  getResourceServer: 'ResourceServerDiscovery',
  getServiceHealth: 'ServiceHealth',
  getOpenApiDocument: 'OpenApiDocument',
  listMediaTrends: 'MediaResults',
  listPopularMedia: 'MediaResults',
  listMediaRecommendations: 'MediaDiscoverPage',
  listMediaGenres: 'MediaGenreResults',
  getPersonCredits: 'MediaPersonCredits',
  getMovieWatchClickouts: 'MediaWatchClickoutsEnvelope',
  getSeriesWatchClickouts: 'MediaWatchClickoutsEnvelope',
  getMovie: 'MediaDetailsEnvelope',
  getSeriesSeason: 'MediaSeasonEnvelope',
  getSeries: 'MediaDetailsEnvelope',
  listBooks: 'BookPage',
  listBookRecommendations: 'BookPage',
  getBook: 'BookEnvelope',
  listMusic: 'MusicPage',
  listMusicRecommendations: 'MusicPage',
  getMusic: 'MusicAlbumEnvelope',
  createMusicDownloadTask: 'MusicDownloadTaskEnvelope',
  listLibraryResources: 'LibraryPage',
  listLibraryStates: 'LibraryStateCollection',
  putLibraryResource: 'LibraryStateEnvelope',
  deleteLibraryResource: 'DeletedLibraryResource',
  listMusicCollections: 'MusicCollectionCollection',
  getMusicCollection: 'MusicCollectionEnvelope',
  putMusicCollectionSubscription: 'MusicSubscriptionMutationEnvelope',
  deleteMusicCollectionSubscription: 'MusicSubscriptionMutationEnvelope',
  deleteMusicCollection: 'DeletedId',
  createLibraryMusicAlbum: 'MusicCollectionEnvelope',
  listFavoriteMusicTracks: 'MusicCollectionEnvelope',
  putFavoriteMusicTrack: 'MusicCollectionEnvelope',
  listConnectorProviders: 'ConnectorProviderCollection',
  listConnectors: 'ConnectorCollection',
  createDoubanConnector: 'ConnectorEnvelope',
  createConnectorLoginAttempt: 'ConnectorLoginResult',
  getConnectorLoginAttempt: 'ConnectorLoginResult',
  putConnectorLoginResponse: 'ConnectorLoginResult',
  updateConnector: 'ConnectorEnvelope',
  createConnectorSyncJob: 'ConnectorSyncJobEnvelope',
  getConnectorSyncJob: 'ConnectorSyncJobEnvelope',
  listConnectorPlaylists: 'MusicCollectionCollection',
  putConnectorPlaylists: 'PlaylistSelectionResult',
  listReleaseCandidates: 'ReleaseCandidateResults',
  listIndexers: 'IndexerCollection',
  getIndexer: 'IndexerEnvelope',
  createIndexer: 'IndexerEnvelope',
  updateIndexer: 'IndexerEnvelope',
  getIndexerHealth: 'HealthEnvelope',
  putIndexerHealth: 'HealthEnvelope',
  listMediaSources: 'MediaSourceCollection',
  getMediaSource: 'MediaSourceEnvelope',
  createMediaSource: 'MediaSourceEnvelope',
  updateMediaSource: 'MediaSourceEnvelope',
  getMediaSourceHealth: 'HealthEnvelope',
  putMediaSourceHealth: 'HealthEnvelope',
  listDownloaders: 'DownloaderCollection',
  getDownloader: 'DownloaderEnvelope',
  createDownloader: 'DownloaderEnvelope',
  updateDownloader: 'DownloaderEnvelope',
  getDownloaderHealth: 'HealthEnvelope',
  putDownloaderHealth: 'HealthEnvelope',
  listBrowserDownloads: 'BrowserDownloadTaskPage',
  createBrowserDownload: 'BrowserDownloadResultEnvelope',
}

const sessionRequestSchemaByOperation: Record<string, string> = {
  createMusicDownloadTask: '#/components/schemas/MusicDownloadTaskInput',
  putLibraryResource: '#/components/schemas/LibraryResourceInput',
  deleteLibraryResource: '#/components/schemas/LibraryResourceInput',
  putMusicCollectionSubscription: '#/components/schemas/MusicSubscriptionInput',
  createLibraryMusicAlbum: '#/components/schemas/MusicAlbumInput',
  putFavoriteMusicTrack: '#/components/schemas/FavoriteTrackMutation',
  createDoubanConnector: '#/components/schemas/DoubanConnectorInput',
  createConnectorLoginAttempt: '#/components/schemas/ConnectorLoginStartInput',
  putConnectorLoginResponse: '#/components/schemas/ConnectorLoginResponseInput',
  updateConnector: '#/components/schemas/ConnectorPatch',
  createConnectorSyncJob: '#/components/schemas/ConnectorSyncJobInput',
  putConnectorPlaylists: '#/components/schemas/PlaylistSelectionInput',
  createIndexer: '#/components/schemas/IndexerInput',
  updateIndexer: '#/components/schemas/IndexerInput',
  createMediaSource: '#/components/schemas/MediaSourceInput',
  updateMediaSource: '#/components/schemas/MediaSourceInput',
  createDownloader: '#/components/schemas/DownloaderInput',
  updateDownloader: '#/components/schemas/DownloaderInput',
  createBrowserDownload: '#/components/schemas/BrowserDownloadInput',
}

function sessionRequestSchema(operationId: string) {
  return sessionRequestSchemaByOperation[operationId]
}

function sessionSuccessResponse(operationId: string, entityTagged: boolean) {
  if (operationId === 'getSignedMusicContent') return musicContentResponse(false)
  if (operationId === 'headSignedMusicContent') return musicContentResponse(true)
  if (operationId === 'streamDownloadEvents') {
    return {
      description: 'Server-sent download task events',
      headers: headers(),
      content: { 'text/event-stream': { schema: { type: 'string' } } },
    }
  }
  const name = sessionResponseSchemaByOperation[operationId]
  if (!name) throw new Error(`Missing OpenAPI response schema for ${operationId}`)
  const ref = `#/components/schemas/${name}`
  if (operationId === 'createConnectorSyncJob') {
    return {
      ...success(ref),
      description: 'Connector sync job created',
      headers: { ...headers(), Location: { $ref: '#/components/headers/Location' } },
    }
  }
  if (['getResourceServer', 'getServiceHealth', 'getOpenApiDocument'].includes(operationId)) {
    return publicSuccess(ref)
  }
  return entityTagged ? successWithEntityTag(ref) : success(ref)
}

function musicContentResponse(head: boolean) {
  if (head) {
    return {
      description: 'Resolved track metadata without a response body',
      headers: {
        ...headers(),
        Location: { $ref: '#/components/headers/Location' },
        'Content-Disposition': { schema: { type: 'string' } },
        'Content-Type': { schema: { type: 'string' } },
        'Content-Length': { schema: { type: 'integer', minimum: 0 } },
      },
    }
  }
  return {
    description: 'Tagged audio content',
    headers: {
      ...headers(),
      'Content-Disposition': { schema: { type: 'string' } },
    },
    content: {
      'audio/mpeg': { schema: { type: 'string', format: 'binary' } },
      'audio/flac': { schema: { type: 'string', format: 'binary' } },
      'audio/mp4': { schema: { type: 'string', format: 'binary' } },
      'audio/ogg': { schema: { type: 'string', format: 'binary' } },
    },
  }
}

function musicRedirectResponse() {
  return {
    description: 'Temporary redirect to the resolved track source',
    headers: {
      ...headers(),
      Location: { $ref: '#/components/headers/Location' },
      'Content-Disposition': { schema: { type: 'string' } },
    },
  }
}

function sessionPathParameter(operationId: string, name: string) {
  if (name === 'seasonNumber') return pathParameter(name, { type: 'integer', minimum: 0 })
  if (
    name === 'id' &&
    [
      'getPersonCredits',
      'getMovieWatchClickouts',
      'getSeriesWatchClickouts',
      'getMovie',
      'getSeriesSeason',
      'getSeries',
    ].includes(operationId)
  ) {
    return pathParameter(name, { type: 'integer', minimum: 1 })
  }
  return pathParameter(name, { type: 'string', minLength: 1 })
}

function sessionQueryParameters(operationId: string): object[] {
  const language = queryParameter('language', { type: 'string', minLength: 2 })
  const page = queryParameter('page', { type: 'integer', minimum: 1, default: 1 })
  const pageSize60 = queryParameter('pageSize', { type: 'integer', minimum: 1, maximum: 60, default: 20 })
  const byOperation: Record<string, object[]> = {
    listMediaTrends: [language],
    listPopularMedia: [queryParameter('kind', { type: 'string', enum: ['movie', 'tv'] }, true), language],
    listMediaRecommendations: [
      queryParameter('kind', { type: 'string', enum: ['movie', 'tv'] }, true),
      language,
      page,
      queryParameter('sortBy', {
        type: 'string',
        enum: ['popularity.desc', 'vote_average.desc', 'primary_release_date.desc', 'first_air_date.desc'],
        default: 'popularity.desc',
      }),
      queryParameter('genreId', { type: 'integer', minimum: 1 }),
      queryParameter('originCountry', { type: 'string', pattern: '^[A-Z]{2}$' }),
      queryParameter('year', { type: 'integer', minimum: 1900, maximum: new Date().getUTCFullYear() + 2 }),
      queryParameter('ratingGte', { type: 'number', minimum: 0, maximum: 10 }),
    ],
    listMediaGenres: [queryParameter('kind', { type: 'string', enum: ['movie', 'tv'] }, true), language],
    getPersonCredits: [language],
    getMovieWatchClickouts: [
      language,
      queryParameter('watchRegion', { type: 'string', pattern: '^[A-Z]{2}$', default: 'US' }),
    ],
    getSeriesWatchClickouts: [
      language,
      queryParameter('watchRegion', { type: 'string', pattern: '^[A-Z]{2}$', default: 'US' }),
    ],
    getMovie: [language, queryParameter('watchRegion', { type: 'string', pattern: '^[A-Z]{2}$', default: 'US' })],
    getSeries: [language, queryParameter('watchRegion', { type: 'string', pattern: '^[A-Z]{2}$', default: 'US' })],
    getSeriesSeason: [language],
    listBooks: [queryParameter('q', { type: 'string', minLength: 1 }, true), page, pageSize60],
    listBookRecommendations: [
      queryParameter('mode', { type: 'string', enum: ['trending', 'subject'], default: 'trending' }),
      queryParameter('period', { type: 'string', enum: ['daily', 'weekly', 'monthly', 'yearly'], default: 'daily' }),
      queryParameter('subject', { type: 'string', minLength: 1 }),
      page,
      pageSize60,
    ],
    listMusic: [
      queryParameter('q', { type: 'string', minLength: 1 }),
      queryParameter('artist', { type: 'string', minLength: 1 }),
      queryParameter('title', { type: 'string', minLength: 1 }),
      page,
      pageSize60,
    ],
    listMusicRecommendations: [
      queryParameter('mode', { type: 'string', enum: ['popular', 'genre'], default: 'popular' }),
      queryParameter('range', { type: 'string', enum: ['week', 'month', 'year', 'all_time'], default: 'all_time' }),
      queryParameter('chartType', { type: 'string', enum: ['albums', 'tracks'], default: 'albums' }),
      queryParameter('genre', {
        type: 'string',
        enum: ['rock', 'jazz', 'electronic', 'hip-hop', 'classical', 'pop', 'metal'],
      }),
      queryParameter('releaseType', { type: 'string', enum: ['album', 'ep', 'single'], default: 'album' }),
      queryParameter('year', { type: 'string', pattern: '^(19|20)\\d{2}$' }),
      page,
      pageSize60,
    ],
    listLibraryResources: [
      page,
      queryParameter('pageSize', { type: 'integer', minimum: 1, maximum: 60, default: 36 }),
      language,
      queryParameter('kind', { type: 'string', enum: ['all', 'movie', 'tv', 'music', 'book'], default: 'all' }),
      queryParameter('status', { type: 'string', enum: ['all', 'unwatched', 'watched'], default: 'all' }),
    ],
    listMusicCollections: [queryParameter('kind', { type: 'string', enum: ['playlist', 'album'] }, true)],
    listReleaseCandidates: [
      queryParameter('q', { type: 'string', minLength: 1 }, true),
      queryParameter('searchType', { type: 'string', enum: ['search', 'audiosearch', 'booksearch'] }),
      queryParameter('categories', {
        type: 'string',
        description: 'Comma- or pipe-separated positive category identifiers.',
      }),
    ],
    listBrowserDownloads: [
      queryParameter('status', { $ref: '#/components/schemas/DownloadTaskStatus' }),
      page,
      queryParameter('pageSize', { type: 'integer', minimum: 1, maximum: 50, default: 20 }),
    ],
  }
  return byOperation[operationId] ?? []
}

function queryParameter(name: string, schema: object, required = false) {
  return { name, in: 'query', required, schema }
}

function createOperation(operationId: string, scope: string, input: string, output: string) {
  return {
    operationId,
    summary: operationSummaries[operationId],
    tags: ['release-acquisition'],
    security: secured(scope),
    parameters: [...parameters, { $ref: '#/components/parameters/IdempotencyKey' }],
    requestBody: { required: true, content: json({ $ref: input }) },
    responses: {
      '201': {
        ...success(output),
        description: 'Resource created',
        headers: { ...headers(), Location: { $ref: '#/components/headers/Location' } },
      },
      ...errors,
    },
  }
}
function listOperation(operationId: string, scope: string, schema: string) {
  return {
    operationId,
    summary: operationSummaries[operationId],
    tags: ['release-acquisition'],
    security: secured(scope),
    parameters: [...parameters, { $ref: '#/components/parameters/Page' }, { $ref: '#/components/parameters/PageSize' }],
    responses: { '200': success(schema), ...errors },
  }
}
function childListOperation(operationId: string, scope: string, name: string, schema: string) {
  return {
    ...listOperation(operationId, scope, schema),
    parameters: [
      ...parameters,
      pathParameter(name),
      { $ref: '#/components/parameters/Page' },
      { $ref: '#/components/parameters/PageSize' },
    ],
  }
}
function getOperation(operationId: string, scope: string, name: string, schema: string) {
  return {
    operationId,
    summary: operationSummaries[operationId],
    tags: ['release-acquisition'],
    security: secured(scope),
    parameters: [...parameters, pathParameter(name)],
    responses: { '200': success(schema), ...errors },
  }
}
function pathParameter(name: string, schema: object = { type: 'string', format: 'uuid' }) {
  return { name, in: 'path', required: true, schema }
}
function json(schema: object) {
  return { 'application/json': { schema } }
}
function baseHeaders() {
  return {
    'Request-Id': { $ref: '#/components/headers/RequestId' },
    Link: { $ref: '#/components/headers/Link' },
  }
}
function headers() {
  return { ...baseHeaders(), 'API-Version': { $ref: '#/components/headers/ApiVersion' } }
}
function success(schema: string) {
  return { description: 'Successful response', headers: headers(), content: json({ $ref: schema }) }
}
function publicSuccess(schema: string) {
  return { description: 'Successful response', headers: baseHeaders(), content: json({ $ref: schema }) }
}
function successWithEntityTag(schema: string) {
  return {
    description: 'Successful response',
    headers: { ...headers(), ETag: { $ref: '#/components/headers/ETag' } },
    content: json({ $ref: schema }),
  }
}
function problemResponse(description: string, authenticate = false, versioned = true) {
  return {
    description,
    headers: {
      ...(versioned ? headers() : baseHeaders()),
      ...(authenticate ? { 'WWW-Authenticate': { $ref: '#/components/headers/WwwAuthenticate' } } : {}),
    },
    content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
  }
}
function schemas() {
  const links = { type: 'object', additionalProperties: { type: 'string', format: 'uri' } }
  const pagination = {
    type: 'object',
    required: ['page', 'pageSize', 'totalItems', 'totalPages'],
    properties: {
      page: { type: 'integer' },
      pageSize: { type: 'integer' },
      totalItems: { type: 'integer' },
      totalPages: { type: 'integer' },
    },
  }
  const collection = (item: string) => ({
    type: 'object',
    required: ['items', 'pagination'],
    properties: { items: { type: 'array', items: { $ref: item } }, pagination },
  })
  const items = (item: string) => ({
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: { items: { type: 'array', items: { $ref: item } } },
  })
  const envelope = (name: string) => ({
    type: 'object',
    additionalProperties: false,
    required: ['item'],
    properties: { item: { $ref: `#/components/schemas/${name}` } },
  })
  const nullableString = { type: ['string', 'null'] }
  const dateTime = { type: 'string', format: 'date-time' }
  const nullableDateTime = { type: ['string', 'null'], format: 'date-time' }
  const stringMap = { type: 'object', additionalProperties: { type: 'string' } }
  const health = {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'message', 'checkedAt'],
    properties: {
      status: { type: 'string', enum: ['unknown', 'online', 'offline'] },
      message: nullableString,
      checkedAt: nullableDateTime,
    },
  }
  return {
    Problem: {
      type: 'object',
      required: ['type', 'title', 'status', 'detail', 'instance'],
      properties: {
        type: { type: 'string', format: 'uri' },
        title: { type: 'string' },
        status: { type: 'integer' },
        detail: { type: 'string' },
        instance: { type: 'string' },
        errors: {
          type: 'array',
          items: {
            type: 'object',
            required: ['path', 'message'],
            properties: { path: { type: 'string' }, message: { type: 'string' } },
          },
        },
      },
    },
    ResourceServerDiscovery: {
      type: 'object',
      additionalProperties: false,
      required: ['resource', 'openapi'],
      properties: { resource: { type: 'string', format: 'uri' }, openapi: { type: 'string', format: 'uri' } },
    },
    ServiceHealth: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'name'],
      properties: { ok: { type: 'boolean', const: true }, name: { type: 'string', const: 'zme' } },
    },
    OpenApiDocument: {
      type: 'object',
      description: 'An OpenAPI 3.1 document whose recursive shape is defined by the OpenAPI specification.',
      required: ['openapi', 'info', 'paths'],
      properties: {
        openapi: { type: 'string' },
        info: { type: 'object' },
        paths: { type: 'object' },
      },
      additionalProperties: true,
    },
    BrowserMedia: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'kind',
        'title',
        'originalTitle',
        'overview',
        'posterUrl',
        'backdropUrl',
        'releaseYear',
        'rating',
        'genres',
      ],
      properties: {
        id: { type: 'integer', minimum: 1 },
        kind: { type: 'string', enum: ['movie', 'tv'] },
        title: { type: 'string' },
        originalTitle: { type: 'string' },
        overview: { type: 'string' },
        posterUrl: { type: ['string', 'null'], format: 'uri' },
        backdropUrl: { type: ['string', 'null'], format: 'uri' },
        releaseYear: nullableString,
        rating: { type: ['number', 'null'], minimum: 0, maximum: 10 },
        genres: { type: 'array', items: { type: 'string' } },
      },
    },
    MediaResults: {
      type: 'object',
      additionalProperties: false,
      required: ['results'],
      properties: { results: { type: 'array', items: { $ref: '#/components/schemas/BrowserMedia' } } },
    },
    MediaDiscoverPage: {
      type: 'object',
      additionalProperties: false,
      required: ['results', 'page', 'totalPages', 'totalResults'],
      properties: {
        results: { type: 'array', items: { $ref: '#/components/schemas/BrowserMedia' } },
        page: { type: 'integer', minimum: 1 },
        totalPages: { type: 'integer', minimum: 0 },
        totalResults: { type: 'integer', minimum: 0 },
      },
    },
    MediaGenre: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name'],
      properties: { id: { type: 'integer', minimum: 1 }, name: { type: 'string' } },
    },
    MediaGenreResults: {
      type: 'object',
      additionalProperties: false,
      required: ['genres'],
      properties: { genres: { type: 'array', items: { $ref: '#/components/schemas/MediaGenre' } } },
    },
    MediaPerson: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'name',
        'biography',
        'birthday',
        'deathday',
        'placeOfBirth',
        'knownForDepartment',
        'portraitUrl',
      ],
      properties: {
        id: { type: 'integer', minimum: 1 },
        name: { type: 'string' },
        biography: nullableString,
        birthday: nullableString,
        deathday: nullableString,
        placeOfBirth: nullableString,
        knownForDepartment: nullableString,
        portraitUrl: { type: ['string', 'null'], format: 'uri' },
      },
    },
    MediaPersonCredits: {
      type: 'object',
      additionalProperties: false,
      required: ['person', 'results'],
      properties: {
        person: { $ref: '#/components/schemas/MediaPerson' },
        results: { type: 'array', items: { $ref: '#/components/schemas/BrowserMedia' } },
      },
    },
    MediaWatchClickoutsEnvelope: {
      type: 'object',
      additionalProperties: false,
      required: ['clickouts'],
      properties: { clickouts: { type: 'object', additionalProperties: { type: 'string', format: 'uri' } } },
    },
    MediaDetails: {
      allOf: [
        { $ref: '#/components/schemas/BrowserMedia' },
        {
          type: 'object',
          required: [
            'aliases',
            'englishTitle',
            'tagline',
            'status',
            'homepage',
            'runtime',
            'language',
            'country',
            'director',
            'writers',
            'cast',
            'watch',
            'videos',
            'images',
            'recommendations',
            'similar',
            'seasons',
            'releaseInfo',
            'ids',
          ],
          properties: {
            aliases: { type: 'array', items: { type: 'string' } },
            englishTitle: nullableString,
            tagline: nullableString,
            status: nullableString,
            homepage: { type: ['string', 'null'], format: 'uri' },
            runtime: nullableString,
            language: nullableString,
            country: nullableString,
            director: nullableString,
            writers: { type: 'array', items: { type: 'string' } },
            cast: { type: 'array', items: { $ref: '#/components/schemas/MediaCredit' } },
            watch: { anyOf: [{ $ref: '#/components/schemas/MediaWatchInfo' }, { type: 'null' }] },
            videos: { type: 'array', items: { $ref: '#/components/schemas/MediaVideo' } },
            images: { type: 'array', items: { $ref: '#/components/schemas/MediaImage' } },
            recommendations: { type: 'array', items: { $ref: '#/components/schemas/BrowserMedia' } },
            similar: { type: 'array', items: { $ref: '#/components/schemas/BrowserMedia' } },
            seasons: { type: 'array', items: { $ref: '#/components/schemas/MediaSeasonSummary' } },
            releaseInfo: { anyOf: [{ $ref: '#/components/schemas/MediaReleaseInfo' }, { type: 'null' }] },
            ids: {
              type: 'object',
              required: ['tmdb', 'imdb', 'tvdb'],
              properties: { tmdb: { type: 'string' }, imdb: nullableString, tvdb: nullableString },
            },
          },
        },
      ],
    },
    MediaCredit: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'role', 'portraitUrl'],
      properties: {
        id: { type: 'integer' },
        name: { type: 'string' },
        role: { type: 'string' },
        portraitUrl: { type: ['string', 'null'], format: 'uri' },
      },
    },
    MediaWatchInfo: {
      type: 'object',
      additionalProperties: false,
      required: ['region', 'link', 'groups'],
      properties: {
        region: { type: 'string', pattern: '^[A-Z]{2}$' },
        link: { type: 'string', format: 'uri' },
        groups: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'providers'],
            properties: {
              type: { type: 'string', enum: ['stream', 'free', 'ads', 'rent', 'buy'] },
              providers: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['id', 'name', 'logoUrl', 'url'],
                  properties: {
                    id: { type: 'integer' },
                    name: { type: 'string' },
                    logoUrl: { type: ['string', 'null'], format: 'uri' },
                    url: { type: ['string', 'null'], format: 'uri' },
                  },
                },
              },
            },
          },
        },
      },
    },
    MediaVideo: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'site', 'type', 'key', 'official', 'url'],
      properties: {
        name: { type: 'string' },
        site: { type: 'string' },
        type: { type: 'string' },
        key: { type: 'string' },
        official: { type: 'boolean' },
        url: { type: 'string', format: 'uri' },
      },
    },
    MediaImage: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'url', 'width', 'height'],
      properties: {
        type: { type: 'string', enum: ['backdrop', 'poster', 'logo'] },
        url: { type: 'string', format: 'uri' },
        width: { type: ['integer', 'null'] },
        height: { type: ['integer', 'null'] },
      },
    },
    MediaReleaseInfo: {
      type: 'object',
      additionalProperties: false,
      required: ['certification', 'releaseDate'],
      properties: { certification: nullableString, releaseDate: nullableString },
    },
    MediaSeasonSummary: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'seasonNumber', 'title', 'overview', 'posterUrl', 'airDate', 'episodeCount', 'rating'],
      properties: {
        id: { type: 'integer' },
        seasonNumber: { type: 'integer', minimum: 0 },
        title: { type: 'string' },
        overview: { type: 'string' },
        posterUrl: { type: ['string', 'null'], format: 'uri' },
        airDate: nullableString,
        episodeCount: { type: ['integer', 'null'], minimum: 0 },
        rating: { type: ['number', 'null'] },
      },
    },
    MediaSeasonDetails: {
      allOf: [
        { $ref: '#/components/schemas/MediaSeasonSummary' },
        {
          type: 'object',
          required: ['seriesId', 'episodes'],
          properties: {
            seriesId: { type: 'integer', minimum: 1 },
            episodes: { type: 'array', items: { $ref: '#/components/schemas/MediaEpisode' } },
          },
        },
      ],
    },
    MediaEpisode: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'episodeNumber', 'title', 'overview', 'stillUrl', 'airDate', 'runtime', 'rating'],
      properties: {
        id: { type: 'integer' },
        episodeNumber: { type: 'integer', minimum: 0 },
        title: { type: 'string' },
        overview: { type: 'string' },
        stillUrl: { type: ['string', 'null'], format: 'uri' },
        airDate: nullableString,
        runtime: nullableString,
        rating: { type: ['number', 'null'] },
      },
    },
    MediaDetailsEnvelope: envelope('MediaDetails'),
    MediaSeasonEnvelope: envelope('MediaSeasonDetails'),
    Book: {
      type: 'object',
      additionalProperties: false,
      required: [
        'mediaKey',
        'title',
        'authors',
        'languages',
        'firstPublishYear',
        'coverUrl',
        'isbnCandidates',
        'editionKeys',
        'aliases',
      ],
      properties: {
        mediaKey: { type: 'string', minLength: 1 },
        title: { type: 'string' },
        authors: { type: 'array', items: { type: 'string' } },
        languages: { type: 'array', items: { type: 'string' } },
        firstPublishYear: { type: ['integer', 'null'] },
        coverUrl: { type: ['string', 'null'], format: 'uri' },
        isbnCandidates: { type: 'array', items: { type: 'string' } },
        editionKeys: { type: 'array', items: { type: 'string' } },
        aliases: { type: 'array', items: { type: 'string' } },
        description: nullableString,
        covers: { type: 'array', items: { $ref: '#/components/schemas/BookCover' } },
        workKey: nullableString,
        editionKey: nullableString,
        editionCandidates: { type: 'array', items: { $ref: '#/components/schemas/BookEditionCandidate' } },
      },
    },
    BookCover: {
      type: 'object',
      additionalProperties: false,
      required: ['source', 'size', 'url'],
      properties: {
        source: { type: 'string', const: 'openlibrary' },
        size: { type: 'string', enum: ['small', 'medium', 'large'] },
        url: { type: 'string', format: 'uri' },
      },
    },
    BookEditionCandidate: {
      type: 'object',
      additionalProperties: false,
      required: ['mediaKey', 'openLibraryId', 'title', 'publishYear', 'languages', 'isbnCandidates'],
      properties: {
        mediaKey: { type: 'string' },
        openLibraryId: { type: 'string' },
        title: nullableString,
        publishYear: { type: ['integer', 'null'] },
        languages: { type: 'array', items: { type: 'string' } },
        isbnCandidates: { type: 'array', items: { type: 'string' } },
      },
    },
    BookPage: {
      type: 'object',
      additionalProperties: false,
      required: ['results', 'page', 'totalPages', 'totalResults'],
      properties: {
        results: { type: 'array', items: { $ref: '#/components/schemas/Book' } },
        page: { type: 'integer' },
        totalPages: { type: 'integer' },
        totalResults: { type: 'integer' },
      },
    },
    BookEnvelope: envelope('Book'),
    MusicResource: {
      type: 'object',
      required: ['mediaKey', 'provider', 'resourceType', 'title', 'artists', 'coverArt'],
      properties: {
        mediaKey: { type: 'string' },
        provider: { type: 'string', const: 'musicbrainz' },
        resourceType: { type: 'string', enum: ['release-group', 'release', 'recording'] },
        title: { type: 'string' },
        artist: nullableString,
        artists: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'name', 'joinPhrase'],
            properties: { id: nullableString, name: { type: 'string' }, joinPhrase: { type: 'string' } },
          },
        },
        coverArt: {
          type: 'object',
          required: ['frontUrl', 'frontThumbnailUrl', 'backUrl', 'backThumbnailUrl'],
          properties: {
            frontUrl: nullableString,
            frontThumbnailUrl: nullableString,
            backUrl: nullableString,
            backThumbnailUrl: nullableString,
          },
        },
        mbid: { type: 'string' },
        releaseGroupMbid: { type: 'string' },
        recordingMbid: nullableString,
        releaseMediaKey: { type: 'string' },
        releaseMbid: { type: 'string' },
        albumTitle: nullableString,
        firstReleaseDate: nullableString,
        releaseYear: nullableString,
        releaseDate: nullableString,
        country: nullableString,
        primaryType: nullableString,
        secondaryTypes: { type: 'array', items: { type: 'string' } },
        disambiguation: nullableString,
        durationMs: { type: ['integer', 'null'], minimum: 0 },
        isrcs: { type: 'array', items: { type: 'string' } },
        scoreLabel: nullableString,
      },
    },
    MusicPage: {
      type: 'object',
      additionalProperties: false,
      required: ['results', 'page', 'totalPages', 'totalResults'],
      properties: {
        results: { type: 'array', items: { $ref: '#/components/schemas/MusicResource' } },
        page: { type: 'integer' },
        totalPages: { type: 'integer' },
        totalResults: { type: 'integer' },
      },
    },
    MusicAlbumEnvelope: envelope('MusicResource'),
    MusicDownloadTaskInput: {
      type: 'object',
      additionalProperties: false,
      required: ['trackId', 'downloaderId'],
      properties: {
        trackId: { type: 'string', minLength: 1 },
        downloaderId: { type: 'string', minLength: 1 },
        releaseId: { type: 'string', minLength: 1 },
        quality: { type: 'string', enum: ['standard', 'exhigh', 'lossless', 'hires'] },
        force: { type: 'boolean' },
      },
    },
    MusicDownloadTaskEnvelope: {
      type: 'object',
      additionalProperties: false,
      required: ['item'],
      properties: { item: { $ref: '#/components/schemas/MusicDownloadRecord' } },
    },
    MusicDownloadRecord: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'generation',
        'downloaderId',
        'preferredQuality',
        'resolvedQuality',
        'status',
        'firstAcceptedAt',
        'lastAcceptedAt',
        'errorMessage',
        'updatedAt',
      ],
      properties: {
        id: { type: 'string' },
        generation: { type: 'integer', minimum: 1 },
        downloaderId: nullableString,
        preferredQuality: { type: 'string', enum: ['standard', 'exhigh', 'lossless', 'hires'] },
        resolvedQuality: { type: ['string', 'null'], enum: ['standard', 'exhigh', 'lossless', 'hires', null] },
        status: {
          type: 'string',
          enum: ['queued', 'resolving', 'waiting_source', 'submitting', 'accepted', 'failed', 'canceled'],
        },
        firstAcceptedAt: nullableDateTime,
        lastAcceptedAt: nullableDateTime,
        errorMessage: nullableString,
        updatedAt: dateTime,
      },
    },
    LibraryResourceInput: {
      type: 'object',
      additionalProperties: false,
      required: ['mediaKey', 'kind'],
      properties: {
        mediaKey: { type: 'string', minLength: 1 },
        kind: { type: 'string', enum: ['movie', 'tv', 'music', 'book'] },
        status: { type: 'string', enum: ['saved', 'watched'], default: 'saved' },
      },
    },
    LibraryState: {
      type: 'object',
      additionalProperties: false,
      required: ['mediaKey', 'id', 'kind', 'savedAt', 'watchedAt', 'updatedAt'],
      properties: {
        mediaKey: { type: 'string' },
        id: { type: ['integer', 'null'] },
        kind: { type: 'string', enum: ['movie', 'tv', 'music', 'book'] },
        savedAt: nullableDateTime,
        watchedAt: nullableDateTime,
        updatedAt: dateTime,
      },
    },
    LibraryStateEnvelope: envelope('LibraryState'),
    LibraryStateCollection: items('#/components/schemas/LibraryState'),
    LibraryMedia: {
      allOf: [
        { $ref: '#/components/schemas/BrowserMedia' },
        {
          type: 'object',
          required: ['mediaKey', 'libraryItemId', 'savedAt', 'watchedAt', 'updatedAt'],
          properties: {
            mediaKey: { type: 'string' },
            libraryItemId: { type: 'string' },
            savedAt: nullableDateTime,
            watchedAt: nullableDateTime,
            updatedAt: dateTime,
          },
        },
      ],
    },
    LibraryPage: {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'page', 'pageSize', 'totalResults', 'totalPages'],
      properties: {
        items: { type: 'array', items: { $ref: '#/components/schemas/LibraryMedia' } },
        page: { type: 'integer' },
        pageSize: { type: 'integer' },
        totalResults: { type: 'integer' },
        totalPages: { type: 'integer' },
      },
    },
    DeletedLibraryResource: {
      type: 'object',
      additionalProperties: false,
      required: ['mediaKey', 'kind'],
      properties: { mediaKey: { type: 'string' }, kind: { type: 'string', enum: ['movie', 'tv', 'music', 'book'] } },
    },
    MusicCollection: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'kind',
        'provider',
        'externalId',
        'title',
        'description',
        'coverUrl',
        'ownerName',
        'trackCount',
        'libraryAddedAt',
        'remoteUpdatedAt',
        'lastSyncedAt',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        id: { type: 'string' },
        kind: { type: 'string', enum: ['playlist', 'album', 'favorites'] },
        provider: { type: 'string' },
        externalId: { type: 'string' },
        title: { type: 'string' },
        description: nullableString,
        coverUrl: { type: ['string', 'null'], format: 'uri' },
        ownerName: nullableString,
        trackCount: { type: 'integer', minimum: 0 },
        libraryAddedAt: nullableDateTime,
        remoteUpdatedAt: nullableDateTime,
        lastSyncedAt: nullableDateTime,
        createdAt: dateTime,
        updatedAt: dateTime,
        tracks: { type: 'array', items: { $ref: '#/components/schemas/MusicLibraryTrack' } },
        subscription: { anyOf: [{ $ref: '#/components/schemas/MusicSubscription' }, { type: 'null' }] },
      },
    },
    MusicLibraryTrack: {
      type: 'object',
      required: [
        'id',
        'provider',
        'externalId',
        'mediaKey',
        'title',
        'artists',
        'release',
        'coverUrl',
        'durationMs',
        'isrcs',
        'downloadStatus',
        'downloadReason',
        'downloadProviderCode',
        'downloadCheckedAt',
        'position',
        'addedAt',
        'downloadRecord',
      ],
      properties: {
        id: { type: 'string' },
        provider: { type: 'string' },
        externalId: { type: 'string' },
        mediaKey: { type: 'string' },
        title: { type: 'string' },
        artists: { type: 'array', items: { type: 'string' } },
        release: { anyOf: [{ $ref: '#/components/schemas/MusicLibraryRelease' }, { type: 'null' }] },
        coverUrl: { type: ['string', 'null'], format: 'uri' },
        durationMs: { type: ['integer', 'null'], minimum: 0 },
        isrcs: { type: 'array', items: { type: 'string' } },
        downloadStatus: { type: 'string', enum: ['available', 'unavailable', 'unknown'] },
        downloadReason: nullableString,
        downloadProviderCode: nullableString,
        downloadCheckedAt: nullableDateTime,
        position: { type: 'integer', minimum: 0 },
        addedAt: nullableDateTime,
        downloadRecord: { anyOf: [{ $ref: '#/components/schemas/MusicDownloadRecord' }, { type: 'null' }] },
      },
    },
    MusicLibraryRelease: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'provider',
        'externalId',
        'title',
        'artists',
        'releaseDate',
        'releaseType',
        'providerReleaseType',
        'coverUrl',
        'discNumber',
        'trackNumber',
      ],
      properties: {
        id: { type: 'string' },
        provider: { type: 'string' },
        externalId: { type: 'string' },
        title: { type: 'string' },
        artists: { type: 'array', items: { type: 'string' } },
        releaseDate: nullableString,
        releaseType: {
          type: 'string',
          enum: ['album', 'single', 'ep', 'compilation', 'soundtrack', 'live', 'broadcast', 'other', 'unknown'],
        },
        providerReleaseType: nullableString,
        coverUrl: { type: ['string', 'null'], format: 'uri' },
        discNumber: { type: ['integer', 'null'], minimum: 1 },
        trackNumber: { type: ['integer', 'null'], minimum: 1 },
      },
    },
    MusicSubscription: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'enabled', 'downloaderId', 'lastEvaluatedAt', 'createdAt', 'updatedAt'],
      properties: {
        id: { type: 'string' },
        enabled: { type: 'boolean' },
        downloaderId: nullableString,
        lastEvaluatedAt: nullableDateTime,
        createdAt: dateTime,
        updatedAt: dateTime,
      },
    },
    MusicCollectionCollection: items('#/components/schemas/MusicCollection'),
    MusicCollectionEnvelope: envelope('MusicCollection'),
    MusicSubscriptionInput: {
      type: 'object',
      additionalProperties: false,
      required: ['downloaderId'],
      properties: { downloaderId: { type: 'string', minLength: 1 } },
    },
    MusicSubscriptionMutationEnvelope: {
      type: 'object',
      additionalProperties: false,
      required: ['item'],
      properties: {
        item: {
          type: 'object',
          required: ['subscription', 'queued', 'waiting', 'skipped', 'canceled'],
          properties: {
            subscription: { $ref: '#/components/schemas/MusicSubscription' },
            queued: { type: 'integer' },
            waiting: { type: 'integer' },
            skipped: { type: 'integer' },
            canceled: { type: 'integer' },
          },
        },
      },
    },
    MusicAlbumInput: {
      type: 'object',
      additionalProperties: false,
      required: ['mediaKey'],
      properties: { mediaKey: { type: 'string', minLength: 1 } },
    },
    FavoriteTrackMutation: {
      type: 'object',
      additionalProperties: false,
      required: ['selected', 'track'],
      properties: {
        selected: { type: 'boolean' },
        track: {
          type: 'object',
          required: [
            'provider',
            'externalId',
            'mediaKey',
            'title',
            'artists',
            'release',
            'coverUrl',
            'durationMs',
            'isrcs',
          ],
          properties: {
            provider: { type: 'string' },
            externalId: { type: 'string' },
            mediaKey: { type: 'string' },
            title: { type: 'string' },
            artists: { type: 'array', items: { type: 'string' } },
            release: { anyOf: [{ $ref: '#/components/schemas/MusicLibraryRelease' }, { type: 'null' }] },
            coverUrl: { type: ['string', 'null'], format: 'uri' },
            durationMs: { type: ['integer', 'null'] },
            isrcs: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    DeletedId: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: { type: 'string' } },
    },
    ConnectorProvider: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'authModes', 'capabilities'],
      properties: {
        kind: { type: 'string' },
        authModes: { type: 'array', items: { type: 'string' } },
        capabilities: {
          type: 'array',
          items: { type: 'string', enum: ['library.import', 'music.playlists.read', 'music.tracks.download'] },
        },
      },
    },
    ConnectorProviderCollection: items('#/components/schemas/ConnectorProvider'),
    Connector: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'kind',
        'displayName',
        'avatarUrl',
        'externalAccountId',
        'authModes',
        'capabilities',
        'status',
        'enabled',
        'lastSyncedAt',
        'lastError',
        'lastResult',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        id: { type: 'string' },
        kind: { type: 'string' },
        displayName: { type: 'string' },
        avatarUrl: { type: ['string', 'null'], format: 'uri' },
        externalAccountId: { type: 'string' },
        authModes: { type: 'array', items: { type: 'string' } },
        capabilities: { type: 'array', items: { type: 'string' } },
        status: { type: 'string', enum: ['connected', 'reauth_required', 'error'] },
        enabled: { type: 'boolean' },
        lastSyncedAt: nullableDateTime,
        lastError: nullableString,
        lastResult: { anyOf: [{ $ref: '#/components/schemas/ConnectorSyncResult' }, { type: 'null' }] },
        createdAt: dateTime,
        updatedAt: dateTime,
      },
    },
    ConnectorSyncResult: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['capability', 'scanned', 'imported', 'saved', 'watched', 'unmatched'],
          properties: {
            capability: { type: 'string', const: 'library.import' },
            scanned: { type: 'integer' },
            imported: { type: 'integer' },
            saved: { type: 'integer' },
            watched: { type: 'integer' },
            unmatched: { type: 'integer' },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['capability', 'playlists', 'selectedPlaylists', 'tracks'],
          properties: {
            capability: { type: 'string', const: 'music.playlists.read' },
            playlists: { type: 'integer' },
            selectedPlaylists: { type: 'integer' },
            tracks: { type: 'integer' },
          },
        },
      ],
    },
    ConnectorCollection: items('#/components/schemas/Connector'),
    ConnectorEnvelope: envelope('Connector'),
    DoubanConnectorInput: {
      type: 'object',
      additionalProperties: false,
      required: ['profileId'],
      properties: { profileId: { type: 'string', minLength: 1 }, enabled: { type: 'boolean', default: true } },
    },
    ConnectorLoginStartInput: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'method', 'input'],
      properties: {
        kind: { type: 'string', minLength: 1 },
        method: { type: 'string', minLength: 1 },
        input: stringMap,
      },
    },
    ConnectorLoginResponseInput: {
      type: 'object',
      additionalProperties: false,
      required: ['challenge', 'input'],
      properties: { challenge: { type: 'string', minLength: 1 }, input: stringMap },
    },
    ConnectorLoginResult: {
      type: 'object',
      additionalProperties: false,
      required: ['attempt', 'connector'],
      properties: {
        attempt: {
          type: 'object',
          required: ['id', 'kind', 'method', 'status', 'challenge', 'expiresAt'],
          properties: {
            id: { type: 'string' },
            kind: { type: 'string' },
            method: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'connected', 'expired'] },
            challenge: { anyOf: [{ $ref: '#/components/schemas/ConnectorAuthChallenge' }, { type: 'null' }] },
            expiresAt: dateTime,
          },
        },
        connector: { anyOf: [{ $ref: '#/components/schemas/Connector' }, { type: 'null' }] },
      },
    },
    ConnectorAuthChallenge: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'url', 'purpose', 'progress', 'expiresAt'],
          properties: {
            type: { type: 'string', const: 'qr' },
            url: { type: 'string', format: 'uri' },
            purpose: { type: 'string', enum: ['login', 'verification'] },
            progress: { type: 'string', enum: ['waiting_scan', 'waiting_confirmation'] },
            expiresAt: dateTime,
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'action', 'fields', 'expiresAt'],
          properties: {
            type: { type: 'string', const: 'form' },
            action: { type: 'string' },
            fields: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'type', 'required'],
                properties: {
                  name: { type: 'string' },
                  type: { type: 'string', enum: ['text', 'password'] },
                  required: { type: 'boolean' },
                },
              },
            },
            expiresAt: dateTime,
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'url', 'expiresAt'],
          properties: {
            type: { type: 'string', const: 'redirect' },
            url: { type: 'string', format: 'uri' },
            expiresAt: dateTime,
          },
        },
      ],
    },
    ConnectorPatch: {
      type: 'object',
      additionalProperties: false,
      required: ['enabled'],
      properties: { enabled: { type: 'boolean' } },
    },
    ConnectorSyncJobInput: {
      type: 'object',
      additionalProperties: false,
      required: ['connectorId'],
      properties: { connectorId: { type: 'string', minLength: 1 } },
    },
    ConnectorSyncJob: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'connectorId', 'status', 'result', 'error', 'createdAt', 'startedAt', 'completedAt'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        connectorId: { type: 'string', minLength: 1 },
        status: { type: 'string', enum: ['queued', 'running', 'completed', 'failed'] },
        result: { anyOf: [{ $ref: '#/components/schemas/ConnectorSyncResult' }, { type: 'null' }] },
        error: nullableString,
        createdAt: dateTime,
        startedAt: nullableDateTime,
        completedAt: nullableDateTime,
      },
    },
    ConnectorSyncJobEnvelope: {
      type: 'object',
      additionalProperties: false,
      required: ['job'],
      properties: { job: { $ref: '#/components/schemas/ConnectorSyncJob' } },
    },
    PlaylistSelectionInput: {
      type: 'object',
      additionalProperties: false,
      required: ['selectedPlaylistIds'],
      properties: {
        selectedPlaylistIds: {
          type: 'array',
          maxItems: 1000,
          uniqueItems: true,
          items: { type: 'string', format: 'uuid' },
        },
      },
    },
    PlaylistSelectionResult: {
      type: 'object',
      additionalProperties: false,
      required: ['selectedPlaylists'],
      properties: { selectedPlaylists: { type: 'integer', minimum: 0 } },
    },
    ReleaseCandidate: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'downloadTarget',
        'title',
        'fileName',
        'indexer',
        'size',
        'seeders',
        'leechers',
        'files',
        'protocol',
        'publishDate',
        'downloadUrl',
        'magnetUrl',
        'infoUrl',
        'infoHash',
        'categories',
        'categoryIds',
        'indexerFlags',
        'imdbId',
        'tmdbId',
        'tvdbId',
      ],
      properties: {
        id: { type: 'string' },
        downloadTarget: { type: ['string', 'null'], enum: ['music', 'ebook', 'audiobook', null] },
        title: { type: 'string' },
        fileName: nullableString,
        indexer: { type: 'string' },
        size: { type: ['integer', 'null'], minimum: 0 },
        seeders: { type: ['integer', 'null'], minimum: 0 },
        leechers: { type: ['integer', 'null'], minimum: 0 },
        files: { type: ['integer', 'null'], minimum: 0 },
        protocol: nullableString,
        publishDate: nullableDateTime,
        downloadUrl: { type: ['string', 'null'], format: 'uri' },
        magnetUrl: nullableString,
        infoUrl: { type: ['string', 'null'], format: 'uri' },
        infoHash: nullableString,
        categories: { type: 'array', items: { type: 'string' } },
        categoryIds: { type: 'array', items: { type: 'integer' } },
        indexerFlags: { type: 'array', items: { type: 'string' } },
        imdbId: { type: ['integer', 'null'] },
        tmdbId: { type: ['integer', 'null'] },
        tvdbId: { type: ['integer', 'null'] },
      },
    },
    ReleaseCandidateResults: {
      type: 'object',
      additionalProperties: false,
      required: ['results'],
      properties: { results: { type: 'array', items: { $ref: '#/components/schemas/ReleaseCandidate' } } },
    },
    Health: health,
    HealthEnvelope: {
      type: 'object',
      additionalProperties: false,
      required: ['health'],
      properties: { health: { $ref: '#/components/schemas/Health' } },
    },
    Indexer: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'description',
        'kind',
        'endpoint',
        'enabled',
        'healthStatus',
        'healthMessage',
        'healthCheckedAt',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        id: { type: 'string' },
        description: nullableString,
        kind: { type: 'string', const: 'prowlarr' },
        endpoint: { type: 'string', format: 'uri' },
        enabled: { type: 'boolean' },
        healthStatus: { type: 'string', enum: ['unknown', 'online', 'offline'] },
        healthMessage: nullableString,
        healthCheckedAt: nullableDateTime,
        createdAt: dateTime,
        updatedAt: dateTime,
        credentials: stringMap,
        options: stringMap,
      },
    },
    IndexerCollection: items('#/components/schemas/Indexer'),
    IndexerEnvelope: envelope('Indexer'),
    IndexerInput: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'endpoint', 'credentials', 'options', 'enabled'],
      properties: {
        description: { type: 'string' },
        kind: { type: 'string', const: 'prowlarr' },
        endpoint: { type: 'string', format: 'uri' },
        credentials: stringMap,
        options: stringMap,
        enabled: { type: 'boolean' },
      },
    },
    MediaSource: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'description',
        'kind',
        'enabled',
        'healthStatus',
        'healthMessage',
        'healthCheckedAt',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        id: { type: 'string' },
        description: nullableString,
        kind: { type: 'string', const: 'tmdb' },
        enabled: { type: 'boolean' },
        healthStatus: { type: 'string', enum: ['unknown', 'online', 'offline'] },
        healthMessage: nullableString,
        healthCheckedAt: nullableDateTime,
        createdAt: dateTime,
        updatedAt: dateTime,
        credentials: stringMap,
        options: stringMap,
      },
    },
    MediaSourceCollection: items('#/components/schemas/MediaSource'),
    MediaSourceEnvelope: envelope('MediaSource'),
    MediaSourceInput: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'credentials', 'options', 'enabled'],
      properties: {
        description: { type: 'string' },
        kind: { type: 'string', const: 'tmdb' },
        credentials: stringMap,
        options: stringMap,
        enabled: { type: 'boolean' },
      },
    },
    Downloader: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'description',
        'kind',
        'supportedSourceTypes',
        'endpoint',
        'enabled',
        'healthStatus',
        'healthMessage',
        'healthCheckedAt',
        'createdAt',
        'updatedAt',
      ],
      properties: {
        id: { type: 'string' },
        description: nullableString,
        kind: { type: 'string', enum: ['zpan', 'qbittorrent', 'transmission', 'aria2'] },
        supportedSourceTypes: { type: 'array', items: { type: 'string', enum: ['http', 'magnet', 'torrent_url'] } },
        endpoint: { type: 'string', format: 'uri' },
        enabled: { type: 'boolean' },
        healthStatus: { type: 'string', enum: ['unknown', 'online', 'offline'] },
        healthMessage: nullableString,
        healthCheckedAt: nullableDateTime,
        createdAt: dateTime,
        updatedAt: dateTime,
        credentials: stringMap,
        options: stringMap,
      },
    },
    DownloaderCollection: items('#/components/schemas/Downloader'),
    DownloaderEnvelope: envelope('Downloader'),
    DownloaderInput: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'endpoint', 'credentials', 'options', 'enabled'],
      properties: {
        description: { type: 'string' },
        kind: { type: 'string', enum: ['zpan', 'qbittorrent', 'transmission', 'aria2'] },
        endpoint: { type: 'string', format: 'uri' },
        credentials: stringMap,
        options: stringMap,
        enabled: { type: 'boolean' },
      },
    },
    DownloadTaskStatus: {
      type: 'string',
      enum: [
        'queued',
        'assigned',
        'running',
        'billing_paused',
        'pausing',
        'paused',
        'uploading',
        'canceling',
        'completed',
        'failed',
        'canceled',
      ],
    },
    BrowserDownloadTask: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'downloaderId',
        'downloaderName',
        'downloaderKind',
        'sourceType',
        'sourceUri',
        'name',
        'targetFolder',
        'category',
        'tags',
        'status',
        'downloadedBytes',
        'storageUploadedBytes',
        'totalBytes',
        'downloadBps',
        'storageUploadBps',
        'errorMessage',
      ],
      properties: {
        id: { type: 'string' },
        downloaderId: { type: 'string' },
        downloaderName: { type: 'string' },
        downloaderKind: { type: 'string', enum: ['zpan', 'qbittorrent', 'transmission', 'aria2'] },
        sourceType: { type: 'string', enum: ['http', 'magnet', 'torrent_url'] },
        sourceUri: { type: 'string' },
        name: { type: 'string' },
        targetFolder: { type: 'string' },
        category: nullableString,
        tags: { type: 'array', items: { type: 'string' } },
        status: { $ref: '#/components/schemas/DownloadTaskStatus' },
        downloadedBytes: { type: 'integer', minimum: 0 },
        storageUploadedBytes: { type: 'integer', minimum: 0 },
        totalBytes: { type: ['integer', 'null'], minimum: 0 },
        downloadBps: { type: 'integer', minimum: 0 },
        storageUploadBps: { type: 'integer', minimum: 0 },
        errorMessage: nullableString,
        outputObjectId: nullableString,
      },
    },
    BrowserDownloadTaskPage: {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'total', 'page', 'pageSize'],
      properties: {
        items: { type: 'array', items: { $ref: '#/components/schemas/BrowserDownloadTask' } },
        total: { type: 'integer', minimum: 0 },
        page: { type: 'integer', minimum: 1 },
        pageSize: { type: 'integer', minimum: 1 },
      },
    },
    BrowserDownloadInput: {
      type: 'object',
      additionalProperties: false,
      required: ['downloaderId', 'uri', 'sourceType'],
      properties: {
        downloaderId: { type: 'string', minLength: 1 },
        uri: { type: 'string', minLength: 1 },
        sourceType: { type: 'string', enum: ['http', 'magnet', 'torrent_url'] },
        title: { type: 'string' },
        category: { type: 'string', minLength: 1, maxLength: 120 },
        targetSubdirectory: { type: 'string' },
        tags: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 80 } },
      },
    },
    BrowserDownloadResult: {
      type: 'object',
      additionalProperties: false,
      required: ['downloaderId', 'status'],
      properties: {
        downloaderId: { type: 'string' },
        status: { type: 'string', enum: ['queued', 'submitted'] },
        downloadRecordId: { type: 'string' },
        externalTaskId: nullableString,
      },
    },
    BrowserDownloadResultEnvelope: envelope('BrowserDownloadResult'),
    Media: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'mediaKey',
        'kind',
        'title',
        'originalTitle',
        'overview',
        'posterUrl',
        'backdropUrl',
        'releaseYear',
        'rating',
        'genres',
      ],
      properties: {
        id: { type: 'integer', minimum: 1 },
        mediaKey: { type: 'string', pattern: '^tmdb:(movie|tv):[1-9][0-9]*$' },
        kind: { type: 'string', enum: ['movie', 'tv'] },
        title: { type: 'string' },
        originalTitle: { type: 'string' },
        overview: { type: 'string' },
        posterUrl: { type: ['string', 'null'], format: 'uri' },
        backdropUrl: { type: ['string', 'null'], format: 'uri' },
        releaseYear: { type: ['string', 'null'] },
        rating: { type: ['number', 'null'], minimum: 0, maximum: 10 },
        genres: { type: 'array', items: { type: 'string' } },
      },
    },
    MediaCollection: collection('#/components/schemas/Media'),
    DownloadDestination: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'kind', 'healthStatus', 'supportedSourceTypes'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        kind: { type: 'string' },
        healthStatus: { type: 'string', enum: ['unknown', 'online', 'offline'] },
        supportedSourceTypes: { type: 'array', items: { type: 'string' } },
      },
    },
    DownloadDestinationCollection: {
      type: 'object',
      required: ['items'],
      properties: { items: { type: 'array', items: { $ref: '#/components/schemas/DownloadDestination' } } },
    },
    CreateReleaseSearchJob: {
      type: 'object',
      required: ['mediaKey', 'mediaTitle', 'query'],
      properties: {
        mediaKey: { type: 'string' },
        mediaTitle: { type: 'string' },
        query: { type: 'string' },
        searchType: { type: 'string', enum: ['search', 'audiosearch', 'booksearch'] },
        categories: { type: 'array', items: { type: 'integer' } },
      },
    },
    ReleaseSearchJob: {
      type: 'object',
      required: ['id', 'mediaKey', 'mediaTitle', 'query', 'searchType', 'categories', 'status', 'createdAt', 'links'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        mediaKey: { type: 'string' },
        mediaTitle: { type: 'string' },
        query: { type: 'string' },
        searchType: { type: 'string' },
        categories: { type: 'array', items: { type: 'integer' } },
        status: { type: 'string', enum: ['running', 'completed', 'failed'] },
        error: { type: ['string', 'null'] },
        createdAt: { type: 'string', format: 'date-time' },
        completedAt: { type: ['string', 'null'], format: 'date-time' },
        links,
      },
    },
    ReleaseSearchJobCollection: collection('#/components/schemas/ReleaseSearchJob'),
    ReleaseSearchResult: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'jobId',
        'title',
        'source',
        'sizeBytes',
        'quality',
        'encoding',
        'availability',
        'publishedAt',
        'links',
      ],
      properties: {
        id: { type: 'string', format: 'uuid' },
        jobId: { type: 'string', format: 'uuid' },
        title: { type: 'string' },
        source: { type: 'string' },
        sizeBytes: { type: ['integer', 'null'], minimum: 0 },
        quality: {
          type: 'object',
          additionalProperties: false,
          required: ['source', 'resolution', 'hdr'],
          properties: {
            source: { type: 'string' },
            resolution: { type: 'string' },
            hdr: { type: 'array', items: { type: 'string' } },
          },
        },
        encoding: {
          type: 'object',
          additionalProperties: false,
          required: ['video', 'audio'],
          properties: { video: { type: 'string' }, audio: { type: 'string' } },
        },
        availability: {
          type: 'object',
          additionalProperties: false,
          required: ['seeders', 'leechers', 'protocol'],
          properties: {
            seeders: { type: ['integer', 'null'], minimum: 0 },
            leechers: { type: ['integer', 'null'], minimum: 0 },
            protocol: { type: ['string', 'null'] },
          },
        },
        publishedAt: { type: ['string', 'null'], format: 'date-time' },
        links,
      },
    },
    ReleaseSearchResultCollection: collection('#/components/schemas/ReleaseSearchResult'),
    CreateDownloadTask: {
      type: 'object',
      required: ['releaseSearchResultId', 'downloaderId'],
      properties: {
        releaseSearchResultId: { type: 'string', format: 'uuid' },
        downloaderId: { type: 'string', format: 'uuid' },
      },
    },
    DownloadTask: {
      type: 'object',
      required: [
        'id',
        'releaseSearchResultId',
        'downloaderId',
        'status',
        'downstreamStatus',
        'progress',
        'result',
        'createdAt',
        'links',
      ],
      properties: {
        id: { type: 'string', format: 'uuid' },
        releaseSearchResultId: { type: 'string', format: 'uuid' },
        downloaderId: { type: 'string', format: 'uuid' },
        status: { type: 'string', enum: ['submitting', 'submitted', 'running', 'completed', 'failed', 'canceled'] },
        externalTaskId: { type: ['string', 'null'] },
        downstreamStatus: {
          type: ['string', 'null'],
          enum: [
            'queued',
            'assigned',
            'running',
            'billing_paused',
            'pausing',
            'paused',
            'uploading',
            'canceling',
            'completed',
            'failed',
            'canceled',
            null,
          ],
        },
        progress: {
          type: 'object',
          additionalProperties: false,
          required: ['downloadedBytes', 'storageUploadedBytes', 'totalBytes', 'downloadBps', 'storageUploadBps'],
          properties: {
            downloadedBytes: { type: 'integer', minimum: 0 },
            storageUploadedBytes: { type: 'integer', minimum: 0 },
            totalBytes: { type: ['integer', 'null'], minimum: 0 },
            downloadBps: { type: 'integer', minimum: 0 },
            storageUploadBps: { type: 'integer', minimum: 0 },
          },
        },
        result: {
          type: ['object', 'null'],
          additionalProperties: false,
          required: ['objectId', 'name', 'targetFolder'],
          properties: {
            objectId: { type: ['string', 'null'] },
            name: { type: ['string', 'null'] },
            targetFolder: { type: ['string', 'null'] },
          },
        },
        error: { type: ['string', 'null'] },
        createdAt: { type: 'string', format: 'date-time' },
        completedAt: { type: ['string', 'null'], format: 'date-time' },
        links,
      },
    },
    DownloadTaskCollection: collection('#/components/schemas/DownloadTask'),
  }
}
