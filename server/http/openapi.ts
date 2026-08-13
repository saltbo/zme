import type { AppConfig } from '@server/config'
import { agentScopeForOperation } from './resource-authorization'

const secured = (operationId: string) => [{ oidcSession: [] }, { oidcDpop: [agentScopeForOperation(operationId)] }]
const traceParameters = [
  { $ref: '#/components/parameters/Traceparent' },
  { $ref: '#/components/parameters/Tracestate' },
]
const parameters = traceParameters
const errors = {
  '400': { $ref: '#/components/responses/BadRequest' },
  '401': { $ref: '#/components/responses/Unauthorized' },
  '403': { $ref: '#/components/responses/Forbidden' },
  '404': { $ref: '#/components/responses/NotFound' },
  '409': { $ref: '#/components/responses/Conflict' },
  '415': { $ref: '#/components/responses/UnsupportedMediaType' },
  '422': { $ref: '#/components/responses/ValidationError' },
  '429': { $ref: '#/components/responses/TooManyRequests' },
  '502': { $ref: '#/components/responses/BadGateway' },
  '503': { $ref: '#/components/responses/ServiceUnavailable' },
  '500': { $ref: '#/components/responses/InternalError' },
}
const sessionErrors = {
  ...errors,
  '401': { $ref: '#/components/responses/SessionUnauthorized' },
  '403': { $ref: '#/components/responses/SessionForbidden' },
}
const publicErrors = {
  '400': { $ref: '#/components/responses/PublicBadRequest' },
  '500': { $ref: '#/components/responses/PublicInternalError' },
}
const operationSummaries: Record<string, string> = {
  listMedia: 'Search the configured media catalog',
  listDownloads: 'List downloads owned by the caller',
  createDownload: 'Create a download from an opaque resource reference',
  getDownload: 'Get an owned download',
}

export function openapiDocument(config: AppConfig) {
  const sessionPaths = sessionApiPaths()
  return {
    openapi: '3.1.0',
    info: {
      title: 'ZME Private Media Library',
      version: '1.0.0',
      license: { name: 'AGPL-3.0-only', identifier: 'AGPL-3.0-only' },
      description:
        "A private media library and download desk for discovering movies, series, anime, music, and books, finding releases, and sending them to the user's own downloaders. Local roles and resource ownership restrict every operation.",
    },
    servers: [{ url: config.resourceUrl }],
    tags: [
      { name: 'media-catalog', description: 'Search the configured media metadata catalog.' },
      { name: 'release-acquisition', description: 'Search releases and submit selected candidates to downloaders.' },
      { name: 'library', description: 'Operate the signed-in user library and music collections.' },
      { name: 'connectors', description: 'Operate signed-in user connector projections.' },
      { name: 'configuration', description: 'Administrator-only indexer, source, and downloader configuration.' },
      { name: 'downloads', description: 'Create, inspect, and manage owned downloads.' },
      { name: 'system', description: 'Public service metadata and health.' },
    ],
    paths: {
      ...sessionPaths,
      '/music/tracks/{id}/content': musicContentPath(),
      '/downloaders': {
        ...sessionPaths['/downloaders'],
        get: {
          operationId: 'listDownloaders',
          summary: 'List safe downloader choices',
          tags: ['downloads'],
          security: secured('listDownloaders'),
          parameters,
          responses: { '200': success('#/components/schemas/DownloaderCollection'), ...errors },
        },
      },
      '/downloaders/{id}': {
        ...sessionPaths['/downloaders/{id}'],
        get: {
          operationId: 'getDownloader',
          summary: 'Get a safe downloader choice',
          tags: ['downloads'],
          security: secured('getDownloader'),
          parameters: [...parameters, pathParameter('id')],
          responses: { '200': success('#/components/schemas/DownloaderEnvelope'), ...errors },
        },
      },
      '/media': {
        get: {
          operationId: 'listMedia',
          summary: operationSummaries.listMedia,
          tags: ['media-catalog'],
          security: secured('listMedia'),
          parameters: [
            ...parameters,
            { name: 'query', in: 'query', required: true, schema: { type: 'string', minLength: 1 } },
            { name: 'kind', in: 'query', schema: { type: 'string', enum: ['movie', 'tv'] } },
            { name: 'language', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': success('#/components/schemas/MediaCollection'), ...errors },
        },
      },
      '/release-candidates': {
        get: {
          operationId: 'listReleaseCandidates',
          summary: 'Search ephemeral release candidates',
          tags: ['release-acquisition'],
          security: secured('listReleaseCandidates'),
          parameters: [
            ...parameters,
            { name: 'mediaKey', in: 'query', required: true, schema: { type: 'string', minLength: 1 } },
            { name: 'query', in: 'query', required: true, schema: { type: 'string', minLength: 1 } },
            {
              name: 'searchType',
              in: 'query',
              schema: { type: 'string', enum: ['search', 'audiosearch', 'booksearch'] },
            },
            { name: 'categories', in: 'query', schema: { type: 'string' } },
            { name: 'target', in: 'query', schema: { type: 'string', enum: ['music', 'ebook', 'audiobook'] } },
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 50 } },
          ],
          responses: { '200': success('#/components/schemas/ReleaseCandidateCollection'), ...errors },
        },
      },
      '/downloads': {
        get: {
          ...listOperation('listDownloads', '#/components/schemas/DownloadCollection'),
          parameters: [
            ...parameters,
            { name: 'status', in: 'query', schema: { $ref: '#/components/schemas/DownloadStatus' } },
            { $ref: '#/components/parameters/Page' },
            { $ref: '#/components/parameters/PageSize' },
          ],
        },
        post: createOperation('createDownload', '#/components/schemas/CreateDownload', '#/components/schemas/Download'),
      },
      '/downloads/{downloadId}': {
        get: getOperation('getDownload', 'downloadId', '#/components/schemas/Download'),
        delete: managedDownloadOperation('deleteDownload', '204'),
      },
      '/downloads/{downloadId}/suspension': managedSingletonPath('DownloadSuspension'),
      '/downloads/{downloadId}/cancellation': managedSingletonPath('DownloadCancellation', false),
    },
    components: {
      securitySchemes: {
        oidcSession: {
          type: 'apiKey',
          in: 'cookie',
          name: '__Host-zme_session',
          description: 'Secure local session established by external OIDC.',
        },
        oidcDpop: {
          type: 'openIdConnect',
          openIdConnectUrl: `${config.oidc.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
          description: 'OIDC-issued DPoP-bound resource token. Bearer tokens are rejected.',
          'x-dpop-required': true,
        },
      },
      parameters: {
        IdempotencyKey: {
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
          schema: { type: 'string', minLength: 1, maxLength: 200 },
        },
        Traceparent: {
          name: 'traceparent',
          in: 'header',
          required: false,
          description: 'Optional W3C Trace Context parent. Invalid values are ignored and replaced at the boundary.',
          schema: { type: 'string', pattern: '^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$' },
        },
        Tracestate: {
          name: 'tracestate',
          in: 'header',
          required: false,
          description: 'Optional W3C vendor trace state propagated only with valid trace context.',
          schema: { type: 'string', minLength: 1, maxLength: 512 },
        },
        Page: { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
        PageSize: { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
      },
      headers: {
        RequestId: { schema: { type: 'string', format: 'uuid' } },
        Location: { schema: { type: 'string', format: 'uri' } },
        Link: { schema: { type: 'string' } },
        WwwAuthenticate: {
          description:
            'DPoP challenge with supported proof algorithms and, when applicable, a token, proof, or scope error.',
          schema: { type: 'string', pattern: '^DPoP(?: |$)' },
          example: 'DPoP algs="ES256", error="invalid_token"',
        },
      },
      responses: {
        BadRequest: problemResponse('Invalid protocol request'),
        Unauthorized: problemResponse('Authentication required', true),
        Forbidden: problemResponse('Authorization denied', true),
        SessionUnauthorized: problemResponse('Browser session authentication required'),
        SessionForbidden: problemResponse('Browser session authorization denied'),
        NotFound: problemResponse('Resource not found'),
        Conflict: problemResponse('Resource conflict'),
        UnsupportedMediaType: problemResponse('Request media type is not supported'),
        ValidationError: problemResponse('Request validation failed'),
        TooManyRequests: problemResponse('The upstream or application rate limit was exceeded'),
        BadGateway: problemResponse('An upstream service could not complete the request'),
        ServiceUnavailable: problemResponse('A required service is not configured or is unavailable'),
        InternalError: problemResponse('Unexpected server failure'),
        PublicBadRequest: problemResponse('Malformed public request'),
        PublicInternalError: problemResponse('Unexpected server failure'),
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
  policy?: 'admin' | 'public',
]

const sessionOperations: SessionOperation[] = [
  ['get', '/', 'getResourceServer', 'Get Resource Server discovery metadata', 'system', 'public'],
  ['get', '/health', 'getServiceHealth', 'Get service health', 'system', 'public'],
  ['get', '/openapi.json', 'getOpenApiDocument', 'Get the complete OpenAPI document', 'system', 'public'],
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
  ['get', '/library', 'listLibraryResources', 'List library resources', 'library'],
  ['get', '/library/states', 'listLibraryStates', 'List library resource states', 'library'],
  ['put', '/library/resources/{mediaKey}', 'putLibraryResource', 'Create or replace a library resource', 'library'],
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
  ['post', '/connectors', 'createConnector', 'Create a connector', 'connectors'],
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
  ['get', '/indexers', 'listIndexers', 'List indexers', 'configuration', 'admin'],
  ['get', '/indexers/{id}', 'getIndexer', 'Get an indexer', 'configuration', 'admin'],
  ['post', '/indexers', 'createIndexer', 'Create an indexer', 'configuration', 'admin'],
  ['patch', '/indexers/{id}', 'updateIndexer', 'Update an indexer', 'configuration', 'admin'],
  ['delete', '/indexers/{id}', 'deleteIndexer', 'Delete an indexer', 'configuration', 'admin'],
  [
    'get',
    '/indexers/{id}/health-observations',
    'listIndexerHealthObservations',
    'List indexer health observations',
    'configuration',
    'admin',
  ],
  [
    'post',
    '/indexers/{id}/health-observations',
    'createIndexerHealthObservation',
    'Create an indexer health observation',
    'configuration',
    'admin',
  ],
  [
    'get',
    '/indexers/{id}/health-observations/{checkedAt}',
    'getIndexerHealthObservation',
    'Get an indexer health observation',
    'configuration',
    'admin',
  ],
  ['get', '/media-sources', 'listMediaSources', 'List media sources', 'configuration', 'admin'],
  ['get', '/media-sources/{id}', 'getMediaSource', 'Get a media source', 'configuration', 'admin'],
  ['post', '/media-sources', 'createMediaSource', 'Create a media source', 'configuration', 'admin'],
  ['patch', '/media-sources/{id}', 'updateMediaSource', 'Update a media source', 'configuration', 'admin'],
  ['delete', '/media-sources/{id}', 'deleteMediaSource', 'Delete a media source', 'configuration', 'admin'],
  [
    'get',
    '/media-sources/{id}/health-observations',
    'listMediaSourceHealthObservations',
    'List media-source health observations',
    'configuration',
    'admin',
  ],
  [
    'post',
    '/media-sources/{id}/health-observations',
    'createMediaSourceHealthObservation',
    'Create a media-source health observation',
    'configuration',
    'admin',
  ],
  [
    'get',
    '/media-sources/{id}/health-observations/{checkedAt}',
    'getMediaSourceHealthObservation',
    'Get a media-source health observation',
    'configuration',
    'admin',
  ],
  ['get', '/downloaders', 'listDownloaders', 'List downloaders', 'configuration'],
  ['get', '/downloaders/{id}', 'getDownloader', 'Get a downloader', 'configuration'],
  ['post', '/downloaders', 'createDownloader', 'Create a downloader', 'configuration'],
  ['patch', '/downloaders/{id}', 'updateDownloader', 'Update a downloader', 'configuration'],
  ['delete', '/downloaders/{id}', 'deleteDownloader', 'Delete a downloader', 'configuration'],
  [
    'get',
    '/downloaders/{id}/health-observations',
    'listDownloaderHealthObservations',
    'List downloader health observations',
    'configuration',
  ],
  [
    'post',
    '/downloaders/{id}/health-observations',
    'createDownloaderHealthObservation',
    'Create a downloader health observation',
    'configuration',
  ],
  [
    'get',
    '/downloaders/{id}/health-observations/{checkedAt}',
    'getDownloaderHealthObservation',
    'Get a downloader health observation',
    'configuration',
  ],
]

function sessionApiPaths() {
  const paths: Record<string, Record<string, object>> = {}
  for (const [method, path, operationId, summary, tag, policy] of sessionOperations) {
    const pathParameters = [...path.matchAll(/\{([^}]+)\}/g)].map((match) =>
      sessionPathParameter(operationId, match[1] as string),
    )
    const security = policy === 'public' ? [] : [{ oidcSession: [] }]
    const successStatus = sessionSuccessStatus(operationId, method)
    const noContent = successStatus === '204'
    const operation: Record<string, unknown> = {
      operationId,
      summary,
      tags: [tag],
      security,
      parameters: [
        ...(policy === 'public' ? traceParameters : parameters),
        ...pathParameters,
        ...sessionQueryParameters(operationId),
        ...(operationId === 'createConnectorSyncJob' ? [{ $ref: '#/components/parameters/IdempotencyKey' }] : []),
      ],
      responses: {
        [successStatus]: noContent
          ? { description: 'Resource deleted', headers: headers() }
          : sessionSuccessResponse(operationId, successStatus === '201'),
        ...(policy === 'public' ? publicErrors : sessionErrors),
      },
    }
    if (policy === 'admin') operation['x-zme-local-role'] = 'admin'
    if (operationId === 'listMusic') {
      operation.description = 'At least one of q, artist, or title is required.'
      operation['x-zme-query-constraint'] = { atLeastOne: ['q', 'artist', 'title'] }
    }
    const requestSchema = sessionRequestSchema(operationId)
    if (requestSchema) {
      operation.requestBody = {
        required: true,
        content:
          method === 'patch'
            ? { 'application/merge-patch+json': { schema: { $ref: requestSchema } } }
            : json({ $ref: requestSchema }),
      }
    }
    paths[path] ??= {}
    paths[path][method] = operation
  }
  return paths
}

function sessionSuccessStatus(operationId: string, method: SessionOperation[0]) {
  const overrides: Record<string, string> = {
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
  createConnector: 'ConnectorEnvelope',
  createConnectorLoginAttempt: 'ConnectorLoginResult',
  getConnectorLoginAttempt: 'ConnectorLoginResult',
  putConnectorLoginResponse: 'ConnectorLoginResult',
  updateConnector: 'ConnectorEnvelope',
  createConnectorSyncJob: 'ConnectorSyncJobEnvelope',
  getConnectorSyncJob: 'ConnectorSyncJobEnvelope',
  listConnectorPlaylists: 'MusicCollectionCollection',
  putConnectorPlaylists: 'PlaylistSelectionResult',
  listIndexers: 'IndexerCollection',
  getIndexer: 'IndexerEnvelope',
  createIndexer: 'IndexerEnvelope',
  updateIndexer: 'IndexerEnvelope',
  listIndexerHealthObservations: 'HealthCollection',
  createIndexerHealthObservation: 'HealthEnvelope',
  getIndexerHealthObservation: 'HealthEnvelope',
  listMediaSources: 'MediaSourceCollection',
  getMediaSource: 'MediaSourceEnvelope',
  createMediaSource: 'MediaSourceEnvelope',
  updateMediaSource: 'MediaSourceEnvelope',
  listMediaSourceHealthObservations: 'HealthCollection',
  createMediaSourceHealthObservation: 'HealthEnvelope',
  getMediaSourceHealthObservation: 'HealthEnvelope',
  listDownloaders: 'DownloaderCollection',
  getDownloader: 'DownloaderEnvelope',
  createDownloader: 'DownloaderEnvelope',
  updateDownloader: 'DownloaderEnvelope',
  listDownloaderHealthObservations: 'HealthCollection',
  createDownloaderHealthObservation: 'HealthEnvelope',
  getDownloaderHealthObservation: 'HealthEnvelope',
}

const sessionRequestSchemaByOperation: Record<string, string> = {
  putLibraryResource: '#/components/schemas/LibraryResourceStateInput',
  putMusicCollectionSubscription: '#/components/schemas/MusicSubscriptionInput',
  createLibraryMusicAlbum: '#/components/schemas/MusicAlbumInput',
  putFavoriteMusicTrack: '#/components/schemas/FavoriteTrackMutation',
  createConnector: '#/components/schemas/ConnectorInput',
  createConnectorLoginAttempt: '#/components/schemas/ConnectorLoginStartInput',
  putConnectorLoginResponse: '#/components/schemas/ConnectorLoginResponseInput',
  updateConnector: '#/components/schemas/ConnectorPatch',
  createConnectorSyncJob: '#/components/schemas/ConnectorSyncJobInput',
  putConnectorPlaylists: '#/components/schemas/PlaylistSelectionInput',
  createIndexer: '#/components/schemas/IndexerInput',
  updateIndexer: '#/components/schemas/IndexerPatch',
  createMediaSource: '#/components/schemas/MediaSourceInput',
  updateMediaSource: '#/components/schemas/MediaSourcePatch',
  createDownloader: '#/components/schemas/DownloaderInput',
  updateDownloader: '#/components/schemas/DownloaderPatch',
}

function sessionRequestSchema(operationId: string) {
  return sessionRequestSchemaByOperation[operationId]
}

function sessionSuccessResponse(operationId: string, created: boolean) {
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
  const response = success(ref)
  return created
    ? { ...response, headers: { ...response.headers, Location: { $ref: '#/components/headers/Location' } } }
    : response
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
      queryParameter('mediaKey', { type: 'string', minLength: 1 }, true),
      queryParameter('query', { type: 'string', minLength: 1 }, true),
      queryParameter('searchType', { type: 'string', enum: ['search', 'audiosearch', 'booksearch'] }),
      queryParameter('categories', {
        type: 'string',
        description: 'Comma- or pipe-separated positive category identifiers.',
      }),
      queryParameter('target', { type: 'string', enum: ['music', 'ebook', 'audiobook'] }),
      page,
      queryParameter('pageSize', { type: 'integer', minimum: 1, maximum: 50, default: 50 }),
    ],
  }
  return byOperation[operationId] ?? []
}

function queryParameter(name: string, schema: object, required = false) {
  return { name, in: 'query', required, schema }
}

function createOperation(operationId: string, input: string, output: string) {
  return {
    operationId,
    summary: operationSummaries[operationId],
    tags: ['release-acquisition'],
    security: secured(operationId),
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
function listOperation(operationId: string, schema: string) {
  return {
    operationId,
    summary: operationSummaries[operationId],
    tags: ['release-acquisition'],
    security: secured(operationId),
    parameters: [...parameters, { $ref: '#/components/parameters/Page' }, { $ref: '#/components/parameters/PageSize' }],
    responses: { '200': success(schema), ...errors },
  }
}
function getOperation(operationId: string, name: string, schema: string) {
  return {
    operationId,
    summary: operationSummaries[operationId],
    tags: ['release-acquisition'],
    security: secured(operationId),
    parameters: [...parameters, pathParameter(name)],
    responses: { '200': success(schema), ...errors },
  }
}
function managedDownloadOperation(operationId: string, successStatus: '200' | '204') {
  return {
    operationId,
    summary: operationId,
    tags: ['downloads'],
    security: secured(operationId),
    parameters: [...parameters, pathParameter('downloadId')],
    responses: {
      [successStatus]:
        successStatus === '204'
          ? { description: 'Resource deleted', headers: headers() }
          : success('#/components/schemas/Download'),
      ...errors,
    },
  }
}
function managedSingletonPath(schema: 'DownloadSuspension' | 'DownloadCancellation', removable = true) {
  const path = {
    get: {
      operationId: `get${schema}`,
      summary: `Get ${schema}`,
      tags: ['downloads'],
      security: secured(`get${schema}`),
      parameters: [...parameters, pathParameter('downloadId')],
      responses: { '200': success(`#/components/schemas/${schema}`), ...errors },
    },
    put: {
      ...managedDownloadOperation(`create${schema}`, '200'),
      responses: {
        '200': success(`#/components/schemas/${schema}`),
        '201': {
          ...success(`#/components/schemas/${schema}`),
          description: 'Resource created',
          headers: { ...headers(), Location: { $ref: '#/components/headers/Location' } },
        },
        ...errors,
      },
    },
  } as Record<string, object>
  if (removable) path.delete = managedDownloadOperation('deleteDownloadSuspension', '204')
  return path
}
function musicContentPath() {
  const parameters = [
    pathParameter('id'),
    { name: 'key', in: 'query', required: true, schema: { type: 'string', minLength: 32, maxLength: 256 } },
  ]
  return {
    get: {
      operationId: 'getSignedMusicContent',
      summary: 'Read music track content with a one-time key',
      tags: ['downloads'],
      security: [],
      parameters,
      responses: {
        '200': {
          description: 'Music content returned directly',
          headers: headers(),
          content: { 'audio/mpeg': { schema: { type: 'string', format: 'binary' } } },
        },
        '307': {
          description: 'Temporary redirect to music content',
          headers: { ...headers(), Location: { $ref: '#/components/headers/Location' } },
        },
        ...publicErrors,
      },
    },
    head: {
      operationId: 'headSignedMusicContent',
      summary: 'Inspect music track content with a one-time key',
      tags: ['downloads'],
      security: [],
      parameters,
      responses: { '200': { description: 'Music content metadata', headers: headers() }, ...publicErrors },
    },
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
  return baseHeaders()
}
function success(schema: string) {
  return { description: 'Successful response', headers: headers(), content: json({ $ref: schema }) }
}
function publicSuccess(schema: string) {
  return { description: 'Successful response', headers: baseHeaders(), content: json({ $ref: schema }) }
}
function problemResponse(description: string, authenticate = false) {
  return {
    description,
    headers: {
      ...headers(),
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
            required: ['pointer', 'detail'],
            properties: {
              pointer: { type: 'string', pattern: '^#(?:/.*)?$' },
              detail: { type: 'string' },
            },
            additionalProperties: false,
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
    LibraryResourceStateInput: {
      type: 'object',
      additionalProperties: false,
      properties: {
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
    ConnectorInput: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'profileId'],
      properties: {
        kind: { type: 'string', const: 'douban' },
        profileId: { type: 'string', minLength: 1 },
        enabled: { type: 'boolean', default: true },
      },
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
    ReleaseCandidateQuality: {
      type: 'object',
      additionalProperties: false,
      required: ['resolution', 'source', 'codec', 'hdr', 'audio', 'tier', 'warnings'],
      properties: {
        resolution: { type: 'string', enum: ['2160p', '1080p', '720p', '480p', '360p', 'other'] },
        source: { type: 'string' },
        codec: nullableString,
        hdr: nullableString,
        audio: nullableString,
        tier: { type: 'string', enum: ['excellent', 'good', 'watchable', 'poor', 'unknown'] },
        warnings: {
          type: 'array',
          items: { type: 'string', enum: ['lowQualitySource', 'screenerSource'] },
        },
      },
    },
    ReleaseCandidateAvailability: {
      type: 'object',
      additionalProperties: false,
      required: ['tier'],
      properties: { tier: { type: 'string', enum: ['high', 'medium', 'low', 'none', 'unknown'] } },
    },
    ReleaseCandidate: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'title',
        'size',
        'publishDate',
        'quality',
        'availability',
        'resourceRef',
        'resourceRefExpiresAt',
      ],
      properties: {
        id: { type: 'string', pattern: '^release-candidate:[0-9a-f]{64}$' },
        title: { type: 'string' },
        size: { type: ['integer', 'null'], minimum: 0 },
        publishDate: nullableDateTime,
        quality: { $ref: '#/components/schemas/ReleaseCandidateQuality' },
        availability: { $ref: '#/components/schemas/ReleaseCandidateAvailability' },
        resourceRef: { type: 'string', pattern: '^release-ref:v1:' },
        resourceRefExpiresAt: dateTime,
      },
    },
    ReleaseCandidateFull: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'title',
        'indexer',
        'size',
        'publishDate',
        'quality',
        'availability',
        'resourceRef',
        'resourceRefExpiresAt',
        'downloadTarget',
        'fileName',
        'seeders',
        'leechers',
        'files',
        'sourceType',
        'infoUrl',
        'categories',
        'categoryIds',
        'indexerFlags',
        'imdbId',
        'tmdbId',
        'tvdbId',
      ],
      properties: {
        id: { type: 'string', pattern: '^release-candidate:[0-9a-f]{64}$' },
        title: { type: 'string' },
        indexer: { type: 'string' },
        size: { type: ['integer', 'null'], minimum: 0 },
        publishDate: nullableDateTime,
        quality: { $ref: '#/components/schemas/ReleaseCandidateQuality' },
        availability: { $ref: '#/components/schemas/ReleaseCandidateAvailability' },
        resourceRef: { type: 'string', pattern: '^release-ref:v1:' },
        resourceRefExpiresAt: dateTime,
        downloadTarget: { type: ['string', 'null'], enum: ['music', 'ebook', 'audiobook', null] },
        fileName: nullableString,
        seeders: { type: ['integer', 'null'], minimum: 0 },
        leechers: { type: ['integer', 'null'], minimum: 0 },
        files: { type: ['integer', 'null'], minimum: 0 },
        sourceType: { type: 'string', enum: ['magnet', 'torrent_url'] },
        infoUrl: { type: ['string', 'null'], format: 'uri' },
        categories: { type: 'array', items: { type: 'string' } },
        categoryIds: { type: 'array', items: { type: 'integer' } },
        indexerFlags: { type: 'array', items: { type: 'string' } },
        imdbId: { type: ['integer', 'null'] },
        tmdbId: { type: ['integer', 'null'] },
        tvdbId: { type: ['integer', 'null'] },
      },
    },
    ReleaseCandidateCollection: {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'pagination'],
      properties: {
        items: {
          type: 'array',
          items: releaseCandidateItemSchema(),
        },
        pagination,
      },
    },
    Health: health,
    HealthEnvelope: envelope('Health'),
    HealthCollection: items('#/components/schemas/Health'),
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
    IndexerPatch: {
      type: 'object',
      additionalProperties: false,
      minProperties: 1,
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
    MediaSourcePatch: {
      type: 'object',
      additionalProperties: false,
      minProperties: 1,
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
    DownloaderPatch: {
      type: 'object',
      additionalProperties: false,
      minProperties: 1,
      properties: {
        description: { type: 'string' },
        kind: { type: 'string', enum: ['zpan', 'qbittorrent', 'transmission', 'aria2'] },
        endpoint: { type: 'string', format: 'uri' },
        credentials: stringMap,
        options: stringMap,
        enabled: { type: 'boolean' },
      },
    },
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
    CreateDownload: {
      type: 'object',
      additionalProperties: false,
      required: ['resourceRef', 'downloaderId'],
      properties: {
        resourceRef: { type: 'string', minLength: 1, maxLength: 8000 },
        downloaderId: { type: 'string', format: 'uuid' },
      },
    },
    DownloadStatus: {
      type: 'string',
      enum: [
        'queued',
        'resolving',
        'waitingSource',
        'submitting',
        'submitted',
        'running',
        'pausing',
        'paused',
        'resuming',
        'canceling',
        'completed',
        'failed',
        'canceled',
      ],
    },
    Download: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'resourceRef',
        'resourceKind',
        'resourceKey',
        'downloaderId',
        'downloaderName',
        'downloaderKind',
        'managementSupported',
        'sourceType',
        'sourceUri',
        'name',
        'targetFolder',
        'category',
        'tags',
        'status',
        'stage',
        'externalTaskId',
        'downstreamStatus',
        'progress',
        'result',
        'error',
        'createdAt',
        'updatedAt',
        'completedAt',
        'links',
      ],
      properties: {
        id: { type: 'string', format: 'uuid' },
        resourceRef: { type: 'string' },
        resourceKind: { type: 'string', enum: ['release', 'music_track'] },
        resourceKey: { type: 'string' },
        downloaderId: { type: 'string', format: 'uuid' },
        downloaderName: { type: 'string' },
        downloaderKind: { type: 'string', enum: ['zpan', 'qbittorrent', 'transmission', 'aria2'] },
        managementSupported: { type: 'boolean' },
        sourceType: { type: 'string', enum: ['http', 'magnet', 'torrent_url'] },
        sourceUri: { type: 'string' },
        name: { type: 'string' },
        targetFolder: { type: 'string' },
        category: nullableString,
        tags: { type: 'array', items: { type: 'string' } },
        status: { $ref: '#/components/schemas/DownloadStatus' },
        stage: { type: ['string', 'null'], enum: ['downloading', 'uploading', null] },
        externalTaskId: nullableString,
        downstreamStatus: nullableString,
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
          properties: { objectId: nullableString, name: nullableString, targetFolder: nullableString },
        },
        error: nullableString,
        createdAt: dateTime,
        updatedAt: dateTime,
        completedAt: nullableDateTime,
        links,
      },
    },
    DownloadCollection: collection('#/components/schemas/Download'),
    DownloadSuspension: {
      type: 'object',
      additionalProperties: false,
      required: ['downloadId', 'createdAt', 'links'],
      properties: { downloadId: { type: 'string', format: 'uuid' }, createdAt: dateTime, links },
    },
    DownloadCancellation: {
      type: 'object',
      additionalProperties: false,
      required: ['downloadId', 'createdAt', 'links'],
      properties: { downloadId: { type: 'string', format: 'uuid' }, createdAt: dateTime, links },
    },
  }
}

function releaseCandidateItemSchema() {
  return {
    oneOf: [{ $ref: '#/components/schemas/ReleaseCandidate' }, { $ref: '#/components/schemas/ReleaseCandidateFull' }],
  }
}
