import { app } from '@server/app'
import type { Env } from '@server/env'
import { describe, expect, it } from 'vitest'
import type { openapiDocument } from './openapi'

// The DB throws on any access: these tests cover routing, auth gating, and
// validation, all of which must resolve before any persistence is touched.
const env = {
  ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
  DB: new Proxy(
    {},
    {
      get() {
        throw new Error('Unexpected database access in http wiring test.')
      },
    },
  ),
  PUBLIC_APP_ORIGIN: 'https://zme.test',
  OIDC_ISSUER: 'https://issuer.zme.test',
  OIDC_CLIENT_ID: 'zme-test-client',
  OIDC_ADMIN_SUBJECTS: 'admin-subject',
  OIDC_LEGACY_BINDINGS_JSON: '[]',
} as unknown as Env

function request(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  return app.fetch(new Request(`https://zme.test${path}`, { ...init, headers }), env)
}

describe('http wiring', () => {
  it.each([
    '/api',
    '/api/health',
    '/api/openapi.json',
    '/api/docs',
  ])('serves %s without OIDC configuration, credentials, or application dependencies', async (path) => {
    const publicEnv = {
      PUBLIC_APP_ORIGIN: 'https://zme.test',
      get DB() {
        throw new Error('Public service metadata must not initialize the database.')
      },
    } as unknown as Env
    const response = await app.fetch(new Request(`https://zme.test${path}`), publicEnv)

    expect(response.status).toBe(200)
    expect(response.headers.get('link')).toContain('<https://zme.test/api/openapi.json>; rel="service-desc"')
    expect(response.headers.has('www-authenticate')).toBe(false)
    expect(response.headers.has('location')).toBe(false)
    if (path === '/api/docs') {
      expect(response.headers.get('content-type')).toContain('text/html')
      const html = await response.text()
      expect(html).toContain('<title>ZME API</title>')
      expect(html).toContain('/api/openapi.json')
      expect(html).toContain('createApiReference')
    } else {
      expect(response.headers.get('content-type')).toContain('application/json')
    }
    if (path === '/api/openapi.json') {
      const document = (await response.json()) as ReturnType<typeof openapiDocument>
      expect(document.info.version).toBe('2.0.0')
      expect(document.paths).toHaveProperty(['/openapi.json', 'get', 'security'], [])
      expect(document.paths['/downloads'].post.security).toContainEqual({ oidcDpop: ['downloads:write'] })
      expect(document.components.securitySchemes.oidcDpop).toMatchObject({ type: 'http', scheme: 'DPoP' })
      expect(document.components.securitySchemes.oidcDpop).not.toHaveProperty('openIdConnectUrl')
    }
  })

  it('documents configured OIDC discovery without requiring client or administrator settings', async () => {
    const response = await app.fetch(
      new Request('https://zme.test/api/openapi.json', {
        headers: { Authorization: 'Bearer invalid', Cookie: '__Host-zme_session=invalid' },
      }),
      { PUBLIC_APP_ORIGIN: env.PUBLIC_APP_ORIGIN, OIDC_ISSUER: env.OIDC_ISSUER } as Env,
    )

    expect(response.status).toBe(200)
    const document = (await response.json()) as ReturnType<typeof openapiDocument>
    expect(document.components.securitySchemes.oidcDpop).toMatchObject({
      type: 'openIdConnect',
      openIdConnectUrl: 'https://issuer.zme.test/.well-known/openid-configuration',
    })
  })

  it('publishes RFC 9728 protected resource metadata without authentication or API version [spec: auth/resource-metadata]', async () => {
    const response = await request('/.well-known/oauth-protected-resource/api')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({
      resource: 'https://zme.test/api',
      authorization_servers: ['https://issuer.zme.test'],
      scopes_supported: [
        'media:read',
        'library:read',
        'torrents:read',
        'downloaders:read',
        'downloads:read',
        'downloads:write',
        'downloads:manage',
      ],
      bearer_methods_supported: [],
      resource_name: 'ZME Private Media Library',
      dpop_signing_alg_values_supported: [
        'RS256',
        'RS384',
        'RS512',
        'PS256',
        'PS384',
        'PS512',
        'ES256',
        'ES384',
        'ES512',
        'EdDSA',
      ],
      dpop_bound_access_tokens_required: true,
    })
  })

  it('serves the health check without authentication', async () => {
    const response = await request('/api/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, name: 'zme' })
  })

  it('uses authentication rather than a protocol version header for protected routes', async () => {
    const response = await app.fetch(new Request('https://zme.test/api/library'), env)
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      type: 'https://zme.test/problems/authentication-required',
      status: 401,
    })
  })

  it('keeps keyed music downloads outside the session auth wall', async () => {
    const response = await request('/api/music/tracks/track-1/content')
    expect(response.status).toBe(422)
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    expect(await response.json()).toMatchObject({
      type: 'https://zme.test/problems/validation-error',
      status: 422,
      errors: expect.any(Array),
    })
  })

  it('rejects unauthenticated requests to protected routes', async () => {
    for (const path of ['/api/library/items', '/api/downloads', '/api/catalog/items?q=dune']) {
      const response = await request(path)
      expect(response.status, path).toBe(401)
    }

    const agentSafe = await request('/api/catalog/items?q=dune')
    expect(agentSafe.headers.get('www-authenticate')).toBe(
      'DPoP algs="RS256 RS384 RS512 PS256 PS384 PS512 ES256 ES384 ES512 EdDSA"',
    )

    const browserOnly = await request('/api/connectors')
    expect(browserOnly.headers.has('www-authenticate')).toBe(false)
  })

  it('rejects unauthenticated admin routes at the auth wall, not the admin wall', async () => {
    const response = await request('/api/media-sources')
    expect(response.status).toBe(401)
  })
})
