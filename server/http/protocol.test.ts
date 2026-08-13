import type { Env } from '@server/env'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { describe, expect, it, vi } from 'vitest'
import type { AppEnv } from './context'
import { normalizeProblemMiddleware, problem, requestBoundaryMiddleware, setPageLinks } from './protocol'

const env = {
  PUBLIC_APP_ORIGIN: 'https://zme.test',
  OIDC_ISSUER: 'https://issuer.zme.test',
  OIDC_CLIENT_ID: 'zme-test-client',
  OIDC_ADMIN_SUBJECTS: 'admin-subject',
  OIDC_LEGACY_BINDINGS_JSON: '[]',
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
      errors: [{ pointer: '#/body/name', detail: 'Name is required' }],
    })
    const serialized = await app.request('/validation/message', undefined, env)
    expect(await serialized.json()).toMatchObject({ errors: [{ pointer: '#', detail: 'Invalid value' }] })
    const unparseable = await app.request('/validation/unparseable', undefined, env)
    expect(await unparseable.json()).toMatchObject({
      errors: [{ pointer: '#', detail: 'Request validation failed' }],
    })
  })

  it('does not relabel non-JSON or malformed JSON responses', async () => {
    const app = protocolApp()
    expect((await app.request('/plain', undefined, env)).headers.get('content-type')).toContain('text/plain')
    expect(await (await app.request('/invalid-json', undefined, env)).text()).toBe('{')
  })

  it('correlates request logs with W3C trace and span identifiers', async () => {
    const app = new Hono<AppEnv>()
    app.use('*', requestBoundaryMiddleware)
    app.get('/trace', (c) => c.json({ ok: true }))
    app.get('/page', (c) => {
      setPageLinks(c, { page: 2, pageSize: 20 }, 61)
      return c.json({ items: [], pagination: { page: 2, pageSize: 20, totalItems: 61, totalPages: 4 } })
    })
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})

    const response = await app.request(
      '/trace',
      {
        headers: {
          traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
          tracestate: 'vendor=value',
        },
      },
      env,
    )

    expect(response.status).toBe(200)
    const entry = JSON.parse(String(log.mock.calls.at(-1)?.[0]))
    expect(entry).toMatchObject({
      requestId: expect.any(String),
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: expect.stringMatching(/^[0-9a-f]{16}$/),
    })
    expect(entry.spanId).not.toBe('00f067aa0ba902b7')
    expect(JSON.stringify(entry)).not.toContain('vendor=value')
    const page = await app.request('/page?status=running', undefined, env)
    expect(page.headers.get('link')).toContain('rel="service-desc"')
    expect(page.headers.get('link')).toContain('status=running&page=3&pageSize=20>; rel="next"')
    expect(page.headers.get('link')).toContain('status=running&page=1&pageSize=20>; rel="first"')
    log.mockRestore()
  })
})
