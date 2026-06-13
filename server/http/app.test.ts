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
  BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret!',
} as unknown as Env

function request(path: string, init?: RequestInit) {
  return app.fetch(new Request(`http://zme.test${path}`, init), env)
}

describe('http wiring', () => {
  it('serves the health check without authentication', async () => {
    const response = await request('/api/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, name: 'curarr' })
  })

  it('rejects unauthenticated requests to protected routes', async () => {
    for (const path of ['/api/library', '/api/downloads', '/api/tmdb/search?q=dune']) {
      const response = await request(path)
      expect(response.status, path).toBe(401)
    }
  })

  it('rejects unauthenticated admin routes at the auth wall, not the admin wall', async () => {
    const response = await request('/api/media-sources')
    expect(response.status).toBe(401)
  })

  it('validates the setup payload before touching anything', async () => {
    const response = await request('/api/setup/admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Admin', email: 'not-an-email', password: 'short' }),
    })
    expect(response.status).toBe(400)
  })
})
