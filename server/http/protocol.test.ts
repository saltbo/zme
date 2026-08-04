import type { Env } from '@server/env'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { describe, expect, it } from 'vitest'
import type { AppEnv } from './context'
import { entityTag, ifMatchRevision, normalizeProblemMiddleware, problem } from './protocol'

const env = {
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

function protocolApp() {
  const app = new Hono<AppEnv>()
  app.use('*', normalizeProblemMiddleware)
  app.get('/error/:status', (c) =>
    c.json({ error: 'safe detail' }, Number(c.req.param('status')) as ContentfulStatusCode),
  )
  app.get('/problem', (c) => problem(c, 409, 'conflict', 'Conflict title'))
  app.get('/validation/issues', (c) =>
    c.json(
      {
        success: false,
        error: { issues: [{ path: ['body', 'name'], message: 'Name is required' }, null] },
      },
      400,
    ),
  )
  app.get('/validation/message', (c) =>
    c.json({ success: false, error: { message: JSON.stringify([{ message: 'Invalid value' }]) } }, 400),
  )
  app.get('/validation/unparseable', (c) => c.json({ success: false, error: { message: 'not-json' } }, 400))
  app.get('/plain', (c) => c.text('plain failure', 502))
  app.get('/invalid-json', (_c) => new Response('{', { status: 502, headers: { 'Content-Type': 'application/json' } }))
  app.get('/revision', (c) => c.json({ revision: ifMatchRevision(c) }))
  return app
}

describe('HTTP protocol helpers', () => {
  it('normalizes JSON errors to stable Problem Details titles', async () => {
    const app = protocolApp()
    const expected = new Map([
      [401, 'Authentication required'],
      [403, 'Authorization denied'],
      [404, 'Resource not found'],
      [409, 'Resource conflict'],
      [412, 'Precondition failed'],
      [428, 'Precondition required'],
      [500, 'The request could not be completed'],
      [400, 'Invalid request'],
    ])
    for (const [status, title] of expected) {
      const response = await app.request(`/error/${status}`, undefined, env)
      expect(response.status).toBe(status)
      expect(await response.json()).toMatchObject({ title, detail: 'safe detail', status })
    }
  })

  it('preserves existing Problem Details and uses the title as default detail', async () => {
    const response = await protocolApp().request('/problem', undefined, env)
    expect(await response.json()).toMatchObject({ title: 'Conflict title', detail: 'Conflict title' })
  })

  it('extracts structured and serialized validation issues', async () => {
    const app = protocolApp()
    const structured = await app.request('/validation/issues', undefined, env)
    expect(await structured.json()).toMatchObject({
      status: 422,
      errors: [{ path: 'body.name', message: 'Name is required' }],
    })
    const serialized = await app.request('/validation/message', undefined, env)
    expect(await serialized.json()).toMatchObject({ errors: [{ path: '', message: 'Invalid value' }] })
    const unparseable = await app.request('/validation/unparseable', undefined, env)
    expect(await unparseable.json()).toMatchObject({
      errors: [{ path: '', message: 'Request validation failed' }],
    })
  })

  it('does not relabel non-JSON or malformed JSON responses', async () => {
    const app = protocolApp()
    expect((await app.request('/plain', undefined, env)).headers.get('content-type')).toContain('text/plain')
    expect(await (await app.request('/invalid-json', undefined, env)).text()).toBe('{')
  })

  it('creates and parses strict strong entity tags', async () => {
    const app = protocolApp()
    expect(entityTag('2026-08-04T00:00:00.000Z')).toBe('"2026-08-04T00:00:00.000Z"')
    expect(
      await (await app.request('/revision', { headers: { 'If-Match': '"2026-08-04T00:00:00.000Z"' } }, env)).json(),
    ).toEqual({ revision: '2026-08-04T00:00:00.000Z' })
    expect(await (await app.request('/revision', { headers: { 'If-Match': '*' } }, env)).json()).toEqual({
      revision: null,
    })
  })
})
