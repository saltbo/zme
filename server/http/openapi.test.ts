import { app } from '@server/app'
import type { AppConfig } from '@server/config'
import { describe, expect, it } from 'vitest'
import { openapiDocument } from './openapi'
import { AGENT_OPERATION_POLICIES, AGENT_SCOPES, agentScopeForRequest } from './resource-authorization'

const config: AppConfig = {
  appOrigin: 'https://zme.example',
  resourceUrl: 'https://zme.example/api',
  oidc: {
    issuer: 'https://identity.example/tenant',
    clientId: 'zme',
    tokenEndpointAuthMethod: 'none',
    redirectUri: 'https://zme.example/auth/callback',
    allowedAlgorithms: ['ES256'],
    adminSubjects: new Set(['https://identity.example/tenant|admin']),
    legacyBindings: new Map(),
  },
}

describe('DPoP resource OpenAPI contract', () => {
  const document = openapiDocument(config)
  const paths = document.paths as unknown as Record<string, Record<string, Operation>>
  const operations = Object.entries(paths).flatMap(([path, pathItem]) =>
    Object.entries(pathItem).map(([method, operation]) => ({ path, method, operation })),
  )

  it('uses unique, stable operationIds and resource-shaped paths', () => {
    const operationIds = operations.map(({ operation }) => operation.operationId)
    expect(new Set(operationIds).size).toBe(operationIds.length)
    expect(operationIds.every(Boolean)).toBe(true)

    for (const { path, method } of operations.filter(({ operation }) =>
      operation.security?.some((requirement) => requirement.oidcDpop),
    )) {
      expect(['get', 'post', 'put', 'delete']).toContain(method)
      expect(path).not.toMatch(/\/(search|create|trigger|download|sync|health)(?:\/|$)/i)
      expect(path.replaceAll(/\{[^}]+\}/g, '')).not.toMatch(/[A-Z_]/)
    }
  })

  it('covers every concrete production API route and method', () => {
    const production = new Set(
      app.routes
        .filter(({ method, path }) => method !== 'ALL' && (path === '/api' || path.startsWith('/api/')))
        .map(({ method, path }) => `${method.toLowerCase()} ${normalizePath(path.replace(/^\/api/, '') || '/')}`),
    )
    const documented = new Set(operations.map(({ method, path }) => `${method} ${normalizePath(path)}`))
    expect(documented).toEqual(production)
  })

  it('makes least-privilege DPoP scopes machine-readable on every operation', () => {
    const scopes = new Set<string>()
    const operationIds = new Set<string>()
    for (const { method, path, operation } of operations) {
      expect(operation.tags?.length).toBeGreaterThan(0)
      const dpop = operation.security?.find((requirement) => requirement.oidcDpop)
      if (!dpop) continue
      operationIds.add(operation.operationId)
      expect(dpop?.oidcDpop).toHaveLength(1)
      for (const scope of dpop?.oidcDpop ?? []) scopes.add(scope)
      expect(agentScopeForRequest(method.toUpperCase(), path.replaceAll(/\{[^}]+\}/g, 'resource-id'))).toBe(
        dpop.oidcDpop?.[0],
      )
    }
    expect(operationIds).toEqual(new Set(AGENT_OPERATION_POLICIES.map(({ operationId }) => operationId)))
    const catalogScopes = new Set<string>(AGENT_SCOPES)
    expect([...scopes].every((scope) => catalogScopes.has(scope))).toBe(true)
    expect(agentScopeForRequest('GET', '/library/items')).toBe('library:read')
  })

  it('declares DPoP semantics, pagination, idempotency, and Problem Details', () => {
    expect(document.info.version).toBe('2.0.0')
    expect(document.servers).toEqual([{ url: config.resourceUrl }])
    expect(document.components.securitySchemes.oidcDpop.description).toMatch(/DPoP-bound/)
    expect(document.components.securitySchemes.oidcDpop['x-dpop-required']).toBe(true)
    expect(document.components.parameters.IdempotencyKey.required).toBe(true)
    expect(document.components.parameters.Traceparent.required).toBe(false)
    expect(document.components.parameters.Tracestate.required).toBe(false)
    expect(document.components.schemas.Problem.required).toEqual(
      expect.arrayContaining(['type', 'title', 'status', 'detail', 'instance']),
    )
    expect(paths['/connector-sync-jobs'].post.parameters).toEqual(
      expect.arrayContaining([{ $ref: '#/components/parameters/IdempotencyKey' }]),
    )
    expect(paths['/downloads'].post.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Idempotency-Key', required: false })]),
    )
    expect(paths['/downloads'].get.parameters).toEqual(
      expect.arrayContaining([{ $ref: '#/components/parameters/Page' }, { $ref: '#/components/parameters/PageSize' }]),
    )
    expect(document.components.schemas.ScreenTitleSummary.properties).toHaveProperty('mediaKey')
    expect(document.components.schemas.CreateDownload.required).toEqual(['resourceRef'])
    expect(document.components.schemas.CreateDownload.properties).toHaveProperty('downloaderId')
    expect(document.components.schemas.Download.oneOf).toEqual([
      { $ref: '#/components/schemas/LocalDownload' },
      { $ref: '#/components/schemas/RemoteDownload' },
    ])
    expect(paths).not.toHaveProperty('/download-links')
    expect(paths['/downloads/{downloadId}/content'].get.security).toEqual([])
    expect(parameter(paths['/downloads/{downloadId}'].get, 'downloadId').schema).toEqual({
      type: 'string',
      minLength: 1,
    })
    expect(document.components.schemas.Torrent.properties).not.toHaveProperty('resourceRef')
    expect(document.components.schemas.Torrent.properties).not.toHaveProperty('magnetUrl')
    expect(document.components.schemas.Torrent.properties).not.toHaveProperty('downloadUrl')
    expect(document.components.schemas.Torrent.properties).not.toHaveProperty('infoHash')
    expect(document.components.schemas.Torrent.properties).not.toHaveProperty('indexer')
    expect(document.components.schemas.Torrent.required).toEqual(
      expect.arrayContaining(['quality', 'availability', 'links']),
    )
    expect(document.components.schemas.TorrentResourceRef.properties).toHaveProperty('resourceRef')
    expect(paths['/torrents/{torrentId}'].get.operationId).toBe('getTorrent')
    expect(document.components.schemas.TorrentQuality.required).toEqual(
      expect.arrayContaining(['resolution', 'source', 'tier', 'warnings']),
    )
    expect(document.components.schemas.TorrentFull.properties).toHaveProperty('seeders')
    expect(document.components.schemas.TorrentFull.properties).toHaveProperty('indexer')
    expect(document.components.schemas.TorrentFull.properties).not.toHaveProperty('resourceRef')
    expect(paths['/torrents'].get.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'view' })]),
    )
    expect(paths).not.toHaveProperty('/release-search-jobs')
    expect(paths).not.toHaveProperty('/release-search-results/{releaseSearchResultId}')
    expect(paths).not.toHaveProperty('/download-tasks')
    expect(paths).not.toHaveProperty('/download-destinations')
    expect(document.components.schemas).not.toHaveProperty('SessionPayload')
    expect(document.components.responses.Unauthorized.headers).toHaveProperty('WWW-Authenticate')
    expect(document.components.responses.Forbidden.headers).toHaveProperty('WWW-Authenticate')
    expect(document.components.responses.SessionUnauthorized.headers).not.toHaveProperty('WWW-Authenticate')
    expect(document.components.responses.SessionForbidden.headers).not.toHaveProperty('WWW-Authenticate')
    expect(paths['/library/items'].get.responses?.['401']).toEqual({
      $ref: '#/components/responses/Unauthorized',
    })
    expect(
      openapiDocument({ ...config, oidc: { ...config.oidc, issuer: `${config.oidc.issuer}/` } }).components
        .securitySchemes.oidcDpop,
    ).toMatchObject({ openIdConnectUrl: 'https://identity.example/tenant/.well-known/openid-configuration' })
  })

  it('documents public response headers and browser query constraints precisely', () => {
    for (const path of ['/', '/health', '/openapi.json', '/docs']) {
      expect(paths[path].get.responses?.['200'].headers).not.toHaveProperty('API-Version')
      expect(paths[path].get.responses).not.toHaveProperty('401')
      expect(paths[path].get.parameters).toEqual(
        expect.arrayContaining([
          { $ref: '#/components/parameters/Traceparent' },
          { $ref: '#/components/parameters/Tracestate' },
        ]),
      )
    }
    expect(paths['/docs'].get.security).toEqual([])
    expect(paths['/docs'].get.responses?.['200'].content).toHaveProperty('text/html')
    expect(document.components.responses.PublicBadRequest.headers).not.toHaveProperty('API-Version')
    expect(document.components.responses.PublicInternalError.headers).not.toHaveProperty('API-Version')
    expect(paths['/catalog/albums'].get.description).toMatch(/at least one of q, artist, title, genre, or year/i)
    expect(paths['/catalog/albums'].get['x-zme-query-constraint']).toEqual({
      atLeastOne: ['q', 'artist', 'title', 'genre', 'year'],
    })
    expect(parameter(paths['/catalog/movies'].get, 'year').schema.maximum).toBe(new Date().getUTCFullYear() + 2)
  })

  it('describes download lifecycle and audio semantically', () => {
    expect(paths).not.toHaveProperty('/downloads/events')
    expect(paths).not.toHaveProperty('/music-download-tasks')
    expect(paths['/downloads/{downloadId}/suspension']).toHaveProperty('put')
    expect(paths['/downloads/{downloadId}/suspension']).toHaveProperty('delete')
    expect(paths['/downloads/{downloadId}/cancellation']).toHaveProperty('put')

    expect(paths['/music/tracks/{id}/content']).toHaveProperty('get')
    expect(paths['/music/tracks/{id}/content']).toHaveProperty('head')

    expect(parameter(paths['/catalog/movies/{id}'].get, 'id').schema).toEqual({ type: 'integer', minimum: 1 })
    expect(parameter(paths['/catalog/series/{id}/seasons/{seasonNumber}'].get, 'seasonNumber').schema).toEqual({
      type: 'integer',
      minimum: 0,
    })
    expect(parameter(paths['/catalog/books/{mediaKey}'].get, 'mediaKey').schema).toEqual({
      type: 'string',
      minLength: 1,
      pattern: '^openlibrary:work:OL[0-9]+W$',
    })

    expect(parameter(paths['/catalog/books'].get, 'q').required).toBe(false)
    expect(paths['/catalog/books'].get.description).toMatch(/exactly one of q or subject/)
    expect(parameter(paths['/catalog/movies'].get, 'ratingGte').schema).toMatchObject({
      minimum: 0,
      maximum: 10,
    })
    expect(paths['/downloaders'].post.requestBody?.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/DownloaderInput',
    )
    expect(paths['/downloaders/{id}'].patch.parameters).not.toContainEqual({
      $ref: '#/components/parameters/IfMatch',
    })
    expect(paths['/downloaders/{id}'].patch.requestBody?.content).toEqual({
      'application/merge-patch+json': { schema: { $ref: '#/components/schemas/DownloaderPatch' } },
    })
    expect(paths['/downloaders/{id}'].patch.responses).not.toHaveProperty('412')
    expect(paths['/downloaders/{id}'].patch.responses).not.toHaveProperty('428')

    for (const { operation } of operations) {
      for (const response of Object.values(operation.responses ?? {})) {
        const jsonSchema = response.content?.['application/json']?.schema
        expect(jsonSchema?.$ref).not.toBe('#/components/schemas/SessionPayload')
      }
      for (const mediaType of Object.values(operation.requestBody?.content ?? {})) {
        expect(mediaType.schema.$ref).not.toBe('#/components/schemas/SessionPayload')
      }
    }
  })
})

interface Operation {
  operationId: string
  description?: string
  'x-zme-query-constraint'?: { atLeastOne: string[] }
  tags?: string[]
  security?: Array<Record<string, string[]>>
  parameters: object[]
  requestBody?: { content: Record<string, { schema: { $ref?: string } }> }
  responses?: Record<
    string,
    { headers?: Record<string, object>; content?: Record<string, { schema: { $ref?: string } }> }
  >
}

function parameter(operation: Operation, name: string) {
  const value = operation.parameters.find((candidate) => 'name' in candidate && candidate.name === name)
  if (!value || !('schema' in value)) throw new Error(`Missing ${name} parameter`)
  return value as { required?: boolean; schema: Record<string, unknown> }
}

function normalizePath(path: string) {
  return path.replaceAll(/:[^/]+|\{[^}]+\}/g, '{}')
}
