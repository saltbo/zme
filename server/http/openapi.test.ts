import { app } from '@server/app'
import type { AppConfig } from '@server/config'
import { API_VERSION } from '@server/config'
import { describe, expect, it } from 'vitest'
import { openapiDocument } from './openapi'

const config: AppConfig = {
  appOrigin: 'https://zme.example',
  resourceUrl: 'https://zme.example/api',
  oidc: {
    issuer: 'https://identity.example/tenant',
    clientId: 'zme',
    tokenEndpointAuthMethod: 'none',
    redirectUri: 'https://zme.example/auth/callback',
    postLogoutRedirectUri: 'https://zme.example/login',
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
      expect(['get', 'post']).toContain(method)
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
    for (const { operation } of operations) {
      expect(operation.tags?.length).toBeGreaterThan(0)
      const dpop = operation.security?.find((requirement) => requirement.oidcDpop)
      if (!dpop) continue
      expect(dpop?.oidcDpop).toHaveLength(1)
      for (const scope of dpop?.oidcDpop ?? []) scopes.add(scope)
    }
    expect(scopes).toEqual(
      new Set([
        'media:read',
        'release-search-jobs:write',
        'release-search-jobs:read',
        'download-tasks:write',
        'download-tasks:read',
        'download-destinations:read',
      ]),
    )
  })

  it('declares versioning, DPoP semantics, pagination, idempotency, and Problem Details', () => {
    expect(document.info.version).toBe(API_VERSION)
    expect(document.servers).toEqual([{ url: config.resourceUrl }])
    expect(document.components.securitySchemes.oidcDpop.description).toMatch(/DPoP-bound/)
    expect(document.components.securitySchemes.oidcDpop['x-dpop-required']).toBe(true)
    expect(document.components.parameters.ApiVersion.schema.const).toBe(API_VERSION)
    expect(document.components.parameters.IdempotencyKey.required).toBe(true)
    expect(document.components.schemas.Problem.required).toEqual(
      expect.arrayContaining(['type', 'title', 'status', 'detail', 'instance']),
    )
    expect(paths['/release-search-jobs'].post.parameters).toEqual(
      expect.arrayContaining([{ $ref: '#/components/parameters/IdempotencyKey' }]),
    )
    expect(paths['/connector-sync-jobs'].post.parameters).toEqual(
      expect.arrayContaining([{ $ref: '#/components/parameters/IdempotencyKey' }]),
    )
    expect(paths['/download-tasks'].get.parameters).toEqual(
      expect.arrayContaining([{ $ref: '#/components/parameters/Page' }, { $ref: '#/components/parameters/PageSize' }]),
    )
    expect(document.components.schemas.Media.required).toContain('mediaKey')
    expect(document.components.schemas.DownloadDestination.properties).not.toHaveProperty('endpoint')
    expect(document.components.schemas).not.toHaveProperty('SessionPayload')
    expect(document.components.responses.Unauthorized.headers).toHaveProperty('WWW-Authenticate')
    expect(document.components.responses.Forbidden.headers).toHaveProperty('WWW-Authenticate')
    expect(
      openapiDocument({ ...config, oidc: { ...config.oidc, issuer: `${config.oidc.issuer}/` } }).components
        .securitySchemes.oidcDpop.openIdConnectUrl,
    ).toBe('https://identity.example/tenant/.well-known/openid-configuration')
  })

  it('documents public response headers and browser query constraints precisely', () => {
    for (const path of ['/', '/health', '/openapi.json']) {
      expect(paths[path].get.responses?.['200'].headers).not.toHaveProperty('API-Version')
      expect(paths[path].get.responses).not.toHaveProperty('401')
    }
    expect(document.components.responses.PublicBadRequest.headers).not.toHaveProperty('API-Version')
    expect(document.components.responses.PublicInternalError.headers).not.toHaveProperty('API-Version')
    expect(paths['/music'].get.description).toMatch(/at least one of q, artist, or title/i)
    expect(paths['/music'].get['x-zme-query-constraint']).toEqual({ atLeastOne: ['q', 'artist', 'title'] })
    expect(parameter(paths['/media-recommendations'].get, 'year').schema.maximum).toBe(new Date().getUTCFullYear() + 2)
  })

  it('describes browser requests, path types, SSE, audio, and entity concurrency semantically', () => {
    expect(paths['/downloads/events'].get.parameters).toContainEqual({
      $ref: '#/components/parameters/ApiVersionQuery',
    })
    expect(paths['/downloads/events'].get.parameters).not.toContainEqual({
      $ref: '#/components/parameters/ApiVersion',
    })
    expect(paths['/downloads/events'].get.responses?.['200'].content).toHaveProperty('text/event-stream')
    expect(paths['/downloads/events'].get.responses?.['200'].content).not.toHaveProperty('application/json')

    expect(paths['/music/tracks/{id}/content'].get.responses?.['200'].content).toHaveProperty('audio/mpeg')
    expect(paths['/music/tracks/{id}/content'].get.responses).toHaveProperty('307')
    expect(paths['/music/tracks/{id}/content'].head.responses).toHaveProperty('200')

    expect(parameter(paths['/movies/{id}'].get, 'id').schema).toEqual({ type: 'integer', minimum: 1 })
    expect(parameter(paths['/series/{id}/seasons/{seasonNumber}'].get, 'seasonNumber').schema).toEqual({
      type: 'integer',
      minimum: 0,
    })
    expect(parameter(paths['/books/{mediaKey}'].get, 'mediaKey').schema).toEqual({ type: 'string', minLength: 1 })

    expect(parameter(paths['/books'].get, 'q').required).toBe(true)
    expect(parameter(paths['/media-recommendations'].get, 'ratingGte').schema).toMatchObject({
      minimum: 0,
      maximum: 10,
    })
    expect(paths['/downloaders'].post.requestBody?.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/DownloaderInput',
    )
    expect(paths['/downloaders/{id}'].patch.parameters).toContainEqual({
      $ref: '#/components/parameters/IfMatch',
    })
    expect(paths['/downloaders/{id}'].patch.responses).toHaveProperty('412')
    expect(paths['/downloaders/{id}'].patch.responses).toHaveProperty('428')

    for (const { operation } of operations) {
      for (const response of Object.values(operation.responses ?? {})) {
        const jsonSchema = response.content?.['application/json']?.schema
        expect(jsonSchema?.$ref).not.toBe('#/components/schemas/SessionPayload')
      }
      expect(operation.requestBody?.content['application/json'].schema.$ref).not.toBe(
        '#/components/schemas/SessionPayload',
      )
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
