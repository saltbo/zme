import { app } from '@server/app'
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
  OIDC_TOKEN_ENDPOINT_AUTH_METHOD: 'none',
  OIDC_REDIRECT_URI: 'https://zme.test/auth/callback',
  OIDC_POST_LOGOUT_REDIRECT_URI: 'https://zme.test/login',
  OIDC_ALLOWED_ALGS: 'ES256',
  OIDC_ADMIN_SUBJECTS: 'https://issuer.zme.test|admin-subject',
  OIDC_LEGACY_BINDINGS_JSON: '[]',
  REALMROOT_RESOURCE_URL: 'https://zme.test/api',
} as unknown as Env

function request(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  if (path.startsWith('/api/')) headers.set('API-Version', '2026-08-04')
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
    const response = await request('/api/music/tracks/track-1/content?apiVersion=2026-08-04')
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
  })

  it('rejects unauthenticated admin routes at the auth wall, not the admin wall', async () => {
    const response = await request('/api/media-sources')
    expect(response.status).toBe(401)
  })
})
