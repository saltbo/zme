import { app } from '@server/app'
import { API_VERSION } from '@server/config'
import type { Env } from '@server/env'
import { describe, expect, it } from 'vitest'

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
  if (path.startsWith('/api/')) headers.set('API-Version', API_VERSION)
  return app.fetch(new Request(`https://zme.test${path}`, { ...init, headers }), env)
}

describe('http wiring', () => {
  it('serves the health check without authentication', async () => {
    const response = await request('/api/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, name: 'zme' })
  })

  it('rejects missing API versions with Problem Details', async () => {
    const response = await app.fetch(new Request('https://zme.test/api/library'), env)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      type: 'https://zme.test/problems/unsupported-api-version',
      status: 400,
    })
  })

  it('keeps keyed music downloads outside the session auth wall', async () => {
    const response = await request(`/api/music/tracks/track-1/content?apiVersion=${API_VERSION}`)
    expect(response.status).toBe(422)
    expect(response.headers.get('content-type')).toContain('application/problem+json')
    expect(await response.json()).toMatchObject({
      type: 'https://zme.test/problems/validation-error',
      status: 422,
      errors: expect.any(Array),
    })
  })

  it('rejects unauthenticated requests to protected routes', async () => {
    for (const path of ['/api/library', '/api/downloads', '/api/media?query=dune']) {
      const response = await request(path)
      expect(response.status, path).toBe(401)
    }

    const agentSafe = await request('/api/media?query=dune')
    expect(agentSafe.headers.get('www-authenticate')).toBe(
      'DPoP algs="RS256 RS384 RS512 PS256 PS384 PS512 ES256 ES384 ES512 EdDSA"',
    )

    const browserOnly = await request('/api/library')
    expect(browserOnly.headers.has('www-authenticate')).toBe(false)
  })

  it('rejects unauthenticated admin routes at the auth wall, not the admin wall', async () => {
    const response = await request('/api/media-sources')
    expect(response.status).toBe(401)
  })
})
