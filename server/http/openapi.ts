import type { readOpenApiConfig } from '@server/config'
import { catalogOperations } from './catalog-contract'
import { catalogPathParameter, catalogQueryParameters, catalogSchemas } from './catalog-openapi'
import {
  agentScopeForOperation,
  agentScopeForRequest,
  ZME_RESOURCE_DESCRIPTION,
  ZME_RESOURCE_NAME,
} from './resource-authorization'

const resourceInfo = {
  title: ZME_RESOURCE_NAME,
  description: ZME_RESOURCE_DESCRIPTION,
}
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
  getTorrent: 'Get an available torrent',
  listDownloads: 'List remote downloads owned by the caller',
  createDownload: 'Create a download from an opaque resource reference',
  getDownload: 'Get an owned download',
}

export function openapiDocument(config: ReturnType<typeof readOpenApiConfig>) {
  const sessionPaths = sessionApiPaths()
  return {
    openapi: '3.1.0',
    info: {
      ...resourceInfo,
      version: '2.0.0',
      license: { name: 'AGPL-3.0-only', identifier: 'AGPL-3.0-only' },
    },
    servers: [{ url: config.resourceUrl }],
    tags: [
      {
        name: 'catalog',
        description: 'Read catalog titles, editions, recordings, and their parent-scoped relationships.',
      },
      { name: 'charts', description: 'Read chart definitions, supported periods, and ranked catalog entries.' },
      {
        name: 'torrents',
        description: 'Query and inspect available BitTorrent resources before choosing a download destination.',
      },
      { name: 'library', description: 'Operate the signed-in user library and music collections.' },
      { name: 'connectors', description: 'Operate signed-in user connector projections.' },
      {
        name: 'configuration',
        description: 'Manage connection settings; indexers and media sources require administrator access.',
      },
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
          tags: ['configuration'],
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
          tags: ['configuration'],
          security: secured('getDownloader'),
          parameters: [...parameters, pathParameter('id')],
          responses: { '200': success('#/components/schemas/Downloader'), ...errors },
        },
      },
      '/torrents': {
        get: {
          operationId: 'listTorrents',
          summary: 'Query available BitTorrent resources',
          tags: ['torrents'],
          security: secured('listTorrents'),
          parameters: [...torrentQueryParameters(), ...paginationParameters()],
          responses: { '200': success('#/components/schemas/TorrentCollection'), ...errors },
        },
      },
      '/torrents/{torrentId}': {
        get: {
          operationId: 'getTorrent',
          summary: 'Get a cached torrent and a user-bound download reference',
          tags: ['torrents'],
          security: secured('getTorrent'),
          parameters: [
            ...parameters,
            pathParameter('torrentId', {
              type: 'string',
              pattern: '^torrent:[0-9a-f]{64}$',
            }),
            queryParameter('mediaKey', { type: 'string', maxLength: 300 }),
            queryParameter('target', { type: 'string', enum: ['music', 'ebook', 'audiobook'] }),
          ],
          responses: { '200': success('#/components/schemas/TorrentResourceRef'), ...errors },
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
        get: {
          ...getOperation('getDownload', 'downloadId', '#/components/schemas/Download'),
          description:
            'Read an owned remote task or an unexpired local download. Local downloads are temporary and are not included in the remote task collection.',
          parameters: [...parameters, pathParameter('downloadId', { type: 'string', minLength: 1 })],
          responses: {
            '200': success('#/components/schemas/Download'),
            '410': {
              description: 'Local download expired or invalid',
              content: json({ $ref: '#/components/schemas/Problem' }),
            },
            ...errors,
          },
        },
        delete: managedDownloadOperation('deleteDownload', '204'),
      },
      '/downloads/{downloadId}/content': {
        get: {
          operationId: 'getLocalDownloadContent',
          summary: 'Read a file using a temporary local download capability',
          description:
            'Use the exact href returned by createDownload when downloaderId is omitted. Possession of the unexpired encrypted ID authorizes this file read without cookies or DPoP credentials. Do not send ZME credentials to any other origin. Magnet sources have no file content.',
          tags: ['downloads'],
          security: [],
          parameters: [...parameters, pathParameter('downloadId', { type: 'string', minLength: 1 })],
          responses: {
            '200': {
              description: 'File attachment; upstream URLs and headers are not exposed',
              headers: { ...headers(), 'Content-Disposition': { schema: { type: 'string' } } },
              content: {
                'application/x-bittorrent': { schema: { type: 'string', format: 'binary' } },
                'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
                'audio/mpeg': { schema: { type: 'string', format: 'binary' } },
              },
            },
            '404': {
              description: 'Source has no file content',
              content: json({ $ref: '#/components/schemas/Problem' }),
            },
            '410': {
              description: 'Source expired or invalid',
              content: json({ $ref: '#/components/schemas/Problem' }),
            },
            '502': { description: 'Source file unavailable', content: json({ $ref: '#/components/schemas/Problem' }) },
            ...publicErrors,
          },
        },
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
          ...(config.oidc
            ? {
                type: 'openIdConnect',
                openIdConnectUrl: `${config.oidc.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
              }
            : { type: 'http', scheme: 'DPoP' }),
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
  tag: 'catalog' | 'charts' | 'torrents' | 'library' | 'connectors' | 'configuration' | 'downloads' | 'system',
  policy?: 'admin' | 'public',
]

const sessionOperations: SessionOperation[] = [
  ['get', '/', 'getResourceServer', 'Get Resource Server discovery metadata', 'system', 'public'],
  ['get', '/health', 'getServiceHealth', 'Get service health', 'system', 'public'],
  ['get', '/openapi.json', 'getOpenApiDocument', 'Get the complete OpenAPI document', 'system', 'public'],
  ['get', '/docs', 'getApiReference', 'View the interactive API reference', 'system', 'public'],
  ...catalogOperations.map(
    ([path, operationId, summary, _schema, tag]) => ['get', path, operationId, summary, tag] as const,
  ),
  ['get', '/library/items', 'listLibraryResources', 'List library resources', 'library'],
  ['get', '/library/states', 'listLibraryStates', 'List library resource states', 'library'],
  ['put', '/library/items/{mediaKey}', 'putLibraryResource', 'Create or replace a library resource', 'library'],
  ['delete', '/library/items/{mediaKey}', 'deleteLibraryResource', 'Delete a library resource', 'library'],
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
  ['get', '/library/music/favorites', 'getFavoriteMusicCollection', 'List favorite music tracks', 'library'],
  [
    'put',
    '/library/music/favorites/tracks/{mediaKey}',
    'putFavoriteMusicTrack',
    'Create a favorite track membership',
    'library',
  ],
  [
    'delete',
    '/library/music/favorites/tracks/{mediaKey}',
    'deleteFavoriteMusicTrack',
    'Delete a favorite track membership',
    'library',
  ],
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
    '/connector-login-attempts/{id}/challenge-response',
    'putConnectorChallengeResponse',
    'Replace a connector login challenge response',
    'connectors',
  ],
  [
    'get',
    '/connector-login-attempts/{id}/challenge-response',
    'getConnectorChallengeResponse',
    'Read an accepted form challenge response',
    'connectors',
  ],
  ['patch', '/connectors/{id}', 'updateConnector', 'Update a connector', 'connectors'],
  ['delete', '/connectors/{id}', 'deleteConnector', 'Delete a connector', 'connectors'],
  ['post', '/connector-sync-jobs', 'createConnectorSyncJob', 'Create a connector sync job', 'connectors'],
  ['get', '/connector-sync-jobs/{id}', 'getConnectorSyncJob', 'Get a connector sync job', 'connectors'],
  ['get', '/connectors/{id}/playlists', 'listConnectorPlaylists', 'List connector playlists', 'connectors'],
  [
    'put',
    '/connectors/{id}/playlist-selection',
    'putConnectorPlaylistSelection',
    'Replace the selected-playlist policy',
    'connectors',
  ],
  [
    'get',
    '/connectors/{id}/playlist-selection',
    'getConnectorPlaylistSelection',
    'Read the selected-playlist policy',
    'connectors',
  ],
  ['get', '/indexers', 'listIndexers', 'List indexers', 'configuration', 'admin'],
  ['get', '/indexers/{id}', 'getIndexer', 'Get an indexer', 'configuration', 'admin'],
  ['post', '/indexers', 'createIndexer', 'Create an indexer', 'configuration', 'admin'],
  ['patch', '/indexers/{id}', 'updateIndexer', 'Update an indexer', 'configuration', 'admin'],
  ['delete', '/indexers/{id}', 'deleteIndexer', 'Delete an indexer', 'configuration', 'admin'],

  ['get', '/indexers/{id}/health', 'getIndexerHealth', 'Read current connection health', 'configuration', 'admin'],

  ['get', '/media-sources', 'listMediaSources', 'List media sources', 'configuration', 'admin'],
  ['get', '/media-sources/{id}', 'getMediaSource', 'Get a media source', 'configuration', 'admin'],
  ['post', '/media-sources', 'createMediaSource', 'Create a media source', 'configuration', 'admin'],
  ['patch', '/media-sources/{id}', 'updateMediaSource', 'Update a media source', 'configuration', 'admin'],
  ['delete', '/media-sources/{id}', 'deleteMediaSource', 'Delete a media source', 'configuration', 'admin'],

  [
    'get',
    '/media-sources/{id}/health',
    'getMediaSourceHealth',
    'Read current connection health',
    'configuration',
    'admin',
  ],

  ['get', '/downloaders', 'listDownloaders', 'List downloaders', 'configuration'],
  ['get', '/downloaders/{id}', 'getDownloader', 'Get a downloader', 'configuration'],
  ['post', '/downloaders', 'createDownloader', 'Create a downloader', 'configuration'],
  ['patch', '/downloaders/{id}', 'updateDownloader', 'Update a downloader', 'configuration'],
  ['delete', '/downloaders/{id}', 'deleteDownloader', 'Delete a downloader', 'configuration'],

  ['get', '/downloaders/{id}/health', 'getDownloaderHealth', 'Read current connection health', 'configuration'],
]

function sessionApiPaths() {
  const paths: Record<string, Record<string, object>> = {}
  for (const [method, path, operationId, summary, tag, policy] of sessionOperations) {
    const pathParameters = [...path.matchAll(/\{([^}]+)\}/g)].map((match) =>
      sessionPathParameter(operationId, match[1] as string),
    )
    const agentScope = agentScopeForRequest(method.toUpperCase(), path.replaceAll(/\{[^}]+\}/g, 'resource-id'))
    const security = policy === 'public' ? [] : agentScope ? secured(operationId) : [{ oidcSession: [] }]
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
        ...(policy === 'public' ? publicErrors : agentScope ? errors : sessionErrors),
      },
    }
    if (operationId === 'putConnectorChallengeResponse') {
      ;(operation.responses as Record<string, unknown>)['201'] = {
        ...success('#/components/schemas/ConnectorChallengeResponse'),
        description: 'Challenge response accepted',
        headers: { ...headers(), Location: { $ref: '#/components/headers/Location' } },
      }
    }
    if (policy === 'admin') operation['x-zme-local-role'] = 'admin'
    if (operationId === 'listAlbums') {
      operation.description =
        'At least one of q, artist, title, genre, or year is required. Returns albums, independently of their release editions.'
      operation['x-zme-query-constraint'] = { atLeastOne: ['q', 'artist', 'title', 'genre', 'year'] }
    }
    if (operationId === 'listBooks')
      operation.description = 'Provide exactly one of q or subject. Returns book works, not ISBN editions.'
    if (operationId === 'listChartEntries')
      operation.description =
        'Choose chartId and period from listCharts. Screen charts use pageSize=20. Unsupported periods and irrelevant filters return 422. Totals are omitted when the provider does not report exact counts.'
    if (operationId === 'listMovies' || operationId === 'listSeries')
      operation.description =
        'Keyword search and browse filters are separate query modes; combining q with orderBy, genreId, originCountry, year, or ratingGte returns 422. Page size is 20.'
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
    putConnectorPlaylistSelection: '200',
    putMusicCollectionSubscription: '202',
    deleteConnector: '204',
    deleteIndexer: '204',
    deleteMediaSource: '204',
    deleteDownloader: '204',
    putFavoriteMusicTrack: '204',
    deleteFavoriteMusicTrack: '204',
  }
  return overrides[operationId] ?? (method === 'post' ? '201' : '200')
}

const sessionResponseSchemaByOperation: Record<string, string> = {
  getMediaSourceHealth: 'Health',
  getIndexerHealth: 'Health',
  getDownloaderHealth: 'Health',
  getResourceServer: 'ResourceServerDiscovery',
  getServiceHealth: 'ServiceHealth',
  getOpenApiDocument: 'OpenApiDocument',
  ...Object.fromEntries(catalogOperations.map(([, operationId, , schema]) => [operationId, schema])),
  listLibraryResources: 'LibraryPage',
  listLibraryStates: 'LibraryStateCollection',
  putLibraryResource: 'LibraryState',
  deleteLibraryResource: 'DeletedLibraryResource',
  listMusicCollections: 'MusicCollectionCollection',
  getMusicCollection: 'MusicCollection',
  putMusicCollectionSubscription: 'MusicSubscriptionUpdate',
  deleteMusicCollectionSubscription: 'MusicSubscriptionUpdate',
  deleteMusicCollection: 'DeletedId',
  createLibraryMusicAlbum: 'MusicCollection',
  getFavoriteMusicCollection: 'MusicCollection',
  putFavoriteMusicTrack: 'MusicCollection',
  listConnectorProviders: 'ConnectorProviderCollection',
  listConnectors: 'ConnectorCollection',
  createConnector: 'Connector',
  createConnectorLoginAttempt: 'ConnectorLoginAttempt',
  getConnectorLoginAttempt: 'ConnectorLoginAttempt',
  putConnectorChallengeResponse: 'ConnectorChallengeResponse',
  getConnectorChallengeResponse: 'ConnectorChallengeResponse',
  updateConnector: 'Connector',
  createConnectorSyncJob: 'ConnectorSyncJobEnvelope',
  getConnectorSyncJob: 'ConnectorSyncJobEnvelope',
  listConnectorPlaylists: 'MusicCollectionCollection',
  putConnectorPlaylistSelection: 'PlaylistSelection',
  getConnectorPlaylistSelection: 'PlaylistSelection',
  listIndexers: 'IndexerCollection',
  getIndexer: 'Indexer',
  createIndexer: 'Indexer',
  updateIndexer: 'Indexer',
  listMediaSources: 'MediaSourceCollection',
  getMediaSource: 'MediaSource',
  createMediaSource: 'MediaSource',
  updateMediaSource: 'MediaSource',
  listDownloaders: 'DownloaderCollection',
  getDownloader: 'Downloader',
  createDownloader: 'Downloader',
  updateDownloader: 'Downloader',
}

const sessionRequestSchemaByOperation: Record<string, string> = {
  putLibraryResource: '#/components/schemas/LibraryResourceStateInput',
  putMusicCollectionSubscription: '#/components/schemas/MusicSubscriptionInput',
  createLibraryMusicAlbum: '#/components/schemas/MusicAlbumInput',
  putFavoriteMusicTrack: '#/components/schemas/FavoriteTrackMutation',
  createConnector: '#/components/schemas/ConnectorInput',
  createConnectorLoginAttempt: '#/components/schemas/ConnectorLoginStartInput',
  putConnectorChallengeResponse: '#/components/schemas/ConnectorLoginResponseInput',
  updateConnector: '#/components/schemas/ConnectorPatch',
  createConnectorSyncJob: '#/components/schemas/ConnectorSyncJobInput',
  putConnectorPlaylistSelection: '#/components/schemas/PlaylistSelectionInput',
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
  if (operationId === 'getApiReference') {
    return {
      description: 'Interactive Scalar API reference',
      headers: baseHeaders(),
      content: { 'text/html': { schema: { type: 'string' } } },
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
  const response = success(ref)
  return created
    ? { ...response, headers: { ...response.headers, Location: { $ref: '#/components/headers/Location' } } }
    : response
}

function sessionPathParameter(operationId: string, name: string) {
  const catalog = catalogPathParameter(operationId, name)
  if (catalog) return catalog
  if (name === 'discNumber' || name === 'trackNumber' || name === 'episodeNumber')
    return pathParameter(name, { type: 'integer', minimum: 1 })
  if (name === 'seasonNumber') return pathParameter(name, { type: 'integer', minimum: 0 })
  if (
    name === 'id' &&
    [
      'getPerson',
      'listPersonCredits',
      'listSeriesSeasons',
      'listSeasonEpisodes',
      'getSeriesEpisode',
      'listMovieWatchLinks',
      'listSeriesWatchLinks',
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
  const catalog = catalogQueryParameters(operationId)
  if (catalog) return catalog
  const language = queryParameter('language', { type: 'string', minLength: 2 })
  const page = queryParameter('page', { type: 'integer', minimum: 1, default: 1 })
  const byOperation: Record<string, object[]> = {
    listLibraryResources: [
      page,
      queryParameter('pageSize', { type: 'integer', minimum: 1, maximum: 60, default: 36 }),
      language,
      queryParameter('kind', { type: 'string', enum: ['all', 'movie', 'tv', 'music', 'book'], default: 'all' }),
      queryParameter('status', { type: 'string', enum: ['all', 'unwatched', 'watched'], default: 'all' }),
    ],
    listMusicCollections: [queryParameter('kind', { type: 'string', enum: ['playlist', 'album'] }, true)],
  }
  return byOperation[operationId] ?? []
}

function queryParameter(name: string, schema: object, required = false) {
  return { name, in: 'query', required, schema }
}

function torrentQueryParameters(): object[] {
  return [
    ...parameters,
    queryParameter('q', { type: 'string', minLength: 1, maxLength: 300 }, true),
    queryParameter('mediaKey', { type: 'string', minLength: 1, maxLength: 300 }),
    queryParameter('target', { type: 'string', enum: ['music', 'ebook', 'audiobook'] }),
    queryParameter('view', { type: 'string', enum: ['compact', 'full'], default: 'compact' }),
    {
      ...queryParameter('snapshotId', { type: 'string', format: 'uuid' }),
      description:
        'Follow the returned pagination links. Required after page 1; binds pagination to the original owned query snapshot.',
    },
  ]
}

function paginationParameters(): object[] {
  return [
    queryParameter('page', { type: 'integer', minimum: 1, default: 1 }),
    queryParameter('pageSize', { type: 'integer', minimum: 1, maximum: 50, default: 50 }),
  ]
}

function createOperation(operationId: string, input: string, output: string) {
  return {
    operationId,
    summary: operationSummaries[operationId],
    description:
      'Supply downloaderId to create a remote task (Idempotency-Key required). Omit downloaderId to prepare a local download without creating a remote task. For kind=magnet open href through the system; for kind=file save the proxied attachment and let the system open it. File href values hide the original torrent site. Local metadata and file capabilities expire after five minutes; the magnet URI itself does not. A local response does not imply that a client started or finished. Local downloads are not included in the remote task list.',
    tags: ['downloads'],
    security: secured(operationId),
    parameters: [
      ...parameters,
      {
        name: 'Idempotency-Key',
        in: 'header',
        required: false,
        description:
          'Required when downloaderId is supplied. Reuse only for the identical remote request. Omit for local preparation; local calls issue a fresh temporary capability.',
        schema: { type: 'string', minLength: 1, maxLength: 200 },
      },
    ],
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
    tags: ['downloads'],
    security: secured(operationId),
    parameters: [...parameters, { $ref: '#/components/parameters/Page' }, { $ref: '#/components/parameters/PageSize' }],
    responses: { '200': success(schema), ...errors },
  }
}
function getOperation(operationId: string, name: string, schema: string) {
  return {
    operationId,
    summary: operationSummaries[operationId],
    tags: ['downloads'],
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
      summary: 'Read music track content with a temporary access key',
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
      summary: 'Inspect music track content with a temporary access key',
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
  const nullableString = { type: ['string', 'null'] }
  const dateTime = { type: 'string', format: 'date-time' }
  const nullableDateTime = { type: ['string', 'null'], format: 'date-time' }
  const stringMapPatch = { type: ['object', 'null'], additionalProperties: { type: ['string', 'null'] } }
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
    ...catalogSchemas(),
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
    ScreenTitleSummary: {
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
        mediaKey: { type: 'string', pattern: '^tmdb:(movie|tv):[1-9][0-9]*$' },
        links,

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
    MediaGenre: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name'],
      properties: { id: { type: 'integer', minimum: 1 }, name: { type: 'string' } },
    },
    MediaGenreResults: items('#/components/schemas/MediaGenre'),
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
        links,

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
    MediaWatchLink: {
      type: 'object',
      additionalProperties: false,
      required: ['provider', 'href'],
      properties: { provider: { type: 'string' }, href: { type: 'string', format: 'uri' } },
    },
    MediaWatchLinkCollection: items('#/components/schemas/MediaWatchLink'),
    ScreenTitleDetails: {
      allOf: [
        { $ref: '#/components/schemas/ScreenTitleSummary' },
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
            recommendations: { type: 'array', items: { $ref: '#/components/schemas/ScreenTitleSummary' } },
            similar: { type: 'array', items: { $ref: '#/components/schemas/ScreenTitleSummary' } },
            seasons: { type: 'array', items: { $ref: '#/components/schemas/SeriesSeasonSummary' } },
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
    SeriesSeasonSummary: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'seasonNumber', 'title', 'overview', 'posterUrl', 'airDate', 'episodeCount', 'rating'],
      properties: {
        links,

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
    SeriesSeason: {
      allOf: [
        { $ref: '#/components/schemas/SeriesSeasonSummary' },
        {
          type: 'object',
          required: ['seriesId', 'episodes'],
          properties: {
            links,

            seriesId: { type: 'integer', minimum: 1 },
            episodes: { type: 'array', items: { $ref: '#/components/schemas/SeriesEpisode' } },
          },
        },
      ],
    },
    SeriesEpisode: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'episodeNumber', 'title', 'overview', 'stillUrl', 'airDate', 'runtime', 'rating'],
      properties: {
        links,

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
    BookMetadata: {
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
        links,

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
        editions: { type: 'array', items: { $ref: '#/components/schemas/BookEditionSummary' } },
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
    BookEditionSummary: {
      type: 'object',
      additionalProperties: false,
      required: ['mediaKey', 'openLibraryId', 'title', 'publishYear', 'languages', 'isbnCandidates'],
      properties: {
        links,

        mediaKey: { type: 'string' },
        openLibraryId: { type: 'string' },
        title: nullableString,
        publishYear: { type: ['integer', 'null'] },
        languages: { type: 'array', items: { type: 'string' } },
        isbnCandidates: { type: 'array', items: { type: 'string' } },
      },
    },
    BookPage: collection('#/components/schemas/BookSummary'),
    MusicCatalogSummary: {
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
    LibraryStateCollection: items('#/components/schemas/LibraryState'),
    LibraryMedia: {
      allOf: [
        { $ref: '#/components/schemas/ScreenTitleSummary' },
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
    LibraryPage: collection('#/components/schemas/LibraryMedia'),
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
    MusicSubscriptionInput: {
      type: 'object',
      additionalProperties: false,
      required: ['downloaderId'],
      properties: { downloaderId: { type: 'string', minLength: 1 } },
    },
    MusicSubscriptionUpdate: {
      type: 'object',
      additionalProperties: false,
      required: ['subscription', 'queued', 'waiting', 'skipped', 'canceled'],
      properties: {
        subscription: { $ref: '#/components/schemas/MusicSubscription' },
        queued: { type: 'integer' },
        waiting: { type: 'integer' },
        skipped: { type: 'integer' },
        canceled: { type: 'integer' },
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
      required: ['track'],
      properties: {
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
    ConnectorChallengeResponse: {
      type: 'object',
      additionalProperties: false,
      required: ['attemptId', 'submittedAt', 'links'],
      properties: {
        attemptId: { type: 'string', format: 'uuid' },
        submittedAt: dateTime,
        links: { type: 'object', additionalProperties: { type: 'string', format: 'uri' } },
      },
    },
    ConnectorLoginResponseInput: {
      type: 'object',
      additionalProperties: false,
      required: ['input'],
      properties: { input: stringMap },
    },
    ConnectorLoginAttempt: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'kind', 'method', 'status', 'challenge', 'expiresAt', 'connector', 'links'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        kind: { type: 'string' },
        method: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'connected', 'expired'] },
        challenge: { anyOf: [{ $ref: '#/components/schemas/ConnectorAuthChallenge' }, { type: 'null' }] },
        expiresAt: dateTime,
        connector: { anyOf: [{ $ref: '#/components/schemas/Connector' }, { type: 'null' }] },
        links: { type: 'object', additionalProperties: { type: 'string', format: 'uri' } },
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
    ConnectorSyncJobEnvelope: { $ref: '#/components/schemas/ConnectorSyncJob' },
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
    PlaylistSelection: {
      type: 'object',
      additionalProperties: false,
      required: ['selectedPlaylistIds', 'links'],
      properties: {
        selectedPlaylistIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
        links: { type: 'object', additionalProperties: { type: 'string', format: 'uri' } },
      },
    },
    TorrentQuality: {
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
    TorrentAvailability: {
      type: 'object',
      additionalProperties: false,
      required: ['tier'],
      properties: { tier: { type: 'string', enum: ['high', 'medium', 'low', 'none', 'unknown'] } },
    },
    Torrent: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'title', 'size', 'publishDate', 'quality', 'availability', 'links'],
      properties: torrentProperties(nullableDateTime),
    },
    TorrentResourceRef: {
      type: 'object',
      additionalProperties: false,
      required: [
        'id',
        'title',
        'size',
        'publishDate',
        'quality',
        'availability',
        'links',
        'resourceRef',
        'resourceRefExpiresAt',
      ],
      properties: {
        ...torrentProperties(nullableDateTime),
        resourceRef: { type: 'string', pattern: '^torrent-ref:v1:' },
        resourceRefExpiresAt: dateTime,
      },
    },
    TorrentFull: {
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
        'links',
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
        ...torrentProperties(nullableDateTime),
        indexer: { type: 'string' },
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
    TorrentCollection: {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'pagination'],
      properties: {
        items: {
          type: 'array',
          items: torrentItemSchema(),
        },
        pagination: {
          ...pagination,
          required: [...pagination.required, 'snapshotId', 'expiresAt'],
          properties: { ...pagination.properties, snapshotId: { type: 'string', format: 'uuid' }, expiresAt: dateTime },
        },
      },
    },
    Health: health,
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
        description: { type: ['string', 'null'] },
        kind: { type: 'string', const: 'prowlarr' },
        endpoint: { type: 'string', format: 'uri' },
        credentials: stringMapPatch,
        options: stringMapPatch,
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
        description: { type: ['string', 'null'] },
        kind: { type: 'string', const: 'tmdb' },
        credentials: stringMapPatch,
        options: stringMapPatch,
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
        configuredCredentials: { type: 'array', items: { type: 'string' } },
        options: stringMap,
      },
    },
    DownloaderCollection: items('#/components/schemas/Downloader'),
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
        description: { type: ['string', 'null'] },
        kind: { type: 'string', enum: ['zpan', 'qbittorrent', 'transmission', 'aria2'] },
        endpoint: { type: 'string', format: 'uri' },
        credentials: stringMapPatch,
        options: stringMapPatch,
        enabled: { type: 'boolean' },
      },
    },
    CreateDownload: {
      type: 'object',
      additionalProperties: false,
      required: ['resourceRef'],
      properties: {
        resourceRef: { type: 'string', minLength: 1, maxLength: 8000 },
        downloaderId: {
          type: 'string',
          format: 'uuid',
          description: 'Omit for local system handoff; supply an enabled owned downloader ID for remote download.',
        },
      },
    },
    LocalDownload: {
      description:
        'Temporary local handoff. expiresAt limits ZME metadata and file access; it does not expire the underlying magnet URI.',
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'kind', 'href', 'expiresAt', 'links'],
          properties: {
            id: { type: 'string' },
            kind: { type: 'string', const: 'magnet' },
            href: { type: 'string', format: 'uri' },
            expiresAt: dateTime,
            links: { type: 'object', additionalProperties: { type: 'string', format: 'uri' } },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'kind', 'href', 'filename', 'mediaType', 'expiresAt', 'links'],
          properties: {
            id: { type: 'string' },
            kind: { type: 'string', const: 'file' },
            href: { type: 'string', format: 'uri' },
            filename: { type: 'string' },
            mediaType: { type: 'string' },
            expiresAt: dateTime,
            links: { type: 'object', additionalProperties: { type: 'string', format: 'uri' } },
          },
        },
      ],
      discriminator: { propertyName: 'kind' },
    },
    DownloadStatus: {
      type: 'string',
      enum: [
        'queued',
        'resolving',
        'waitingSource',
        'submitting',
        'submissionUnknown',
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
      description:
        'A temporary local handoff when downloaderId is omitted, or a persisted remote task when it is supplied.',
      oneOf: [{ $ref: '#/components/schemas/LocalDownload' }, { $ref: '#/components/schemas/RemoteDownload' }],
    },
    RemoteDownload: {
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
        'monitoringSupported',
        'submissionRecoverySupported',
        'pollingRequired',
        'sourceType',
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
        resourceKind: { type: 'string', enum: ['torrent', 'music_track'] },
        resourceKey: { type: 'string' },
        downloaderId: { type: 'string', format: 'uuid' },
        downloaderName: { type: 'string' },
        downloaderKind: { type: ['string', 'null'], enum: ['zpan', 'qbittorrent', 'transmission', 'aria2', null] },
        managementSupported: { type: 'boolean' },
        monitoringSupported: {
          type: 'boolean',
          description: 'Whether ZME can read progress and completion from this remote client.',
        },
        submissionRecoverySupported: {
          type: 'boolean',
          description: 'Whether uncertain submission can be reconciled without creating another remote task.',
        },
        pollingRequired: {
          type: 'boolean',
          description: 'Poll only while true; acceptance by a submission-only client is a handoff, not completion.',
        },
        sourceType: { type: 'string', enum: ['http', 'magnet', 'torrent_url'] },
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
    DownloadCollection: collection('#/components/schemas/RemoteDownload'),
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

function torrentProperties(nullableDateTime: object) {
  return {
    id: { type: 'string', pattern: '^torrent:[0-9a-f]{64}$' },
    mediaKey: {
      type: 'string',
      minLength: 1,
      description: 'Optional selected catalog association; not part of the torrent identity.',
    },
    expiresAt: { type: 'string', format: 'date-time' },
    title: { type: 'string' },
    size: { type: ['integer', 'null'], minimum: 0 },
    publishDate: nullableDateTime,
    quality: { $ref: '#/components/schemas/TorrentQuality' },
    availability: { $ref: '#/components/schemas/TorrentAvailability' },
    links: {
      type: 'object',
      additionalProperties: false,
      required: ['self'],
      properties: { self: { type: 'string', format: 'uri' } },
    },
  }
}

function torrentItemSchema() {
  return {
    oneOf: [{ $ref: '#/components/schemas/Torrent' }, { $ref: '#/components/schemas/TorrentFull' }],
  }
}
