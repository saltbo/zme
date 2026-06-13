import { env } from 'cloudflare:test'
import { app } from '@server/app'
import { describe, expect, it } from 'vitest'

const ADMIN = { name: 'Admin', email: 'admin@zme.test', password: 'admin-password-1' }

function request(path: string, init?: RequestInit & { cookie?: string }) {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  if (init?.cookie) headers.set('cookie', init.cookie)
  return app.fetch(new Request(`http://zme.test${path}`, { ...init, headers }), env)
}

async function setupAdmin(): Promise<string> {
  const created = await request('/api/setup/admin', { method: 'POST', body: JSON.stringify(ADMIN) })
  expect(created.status).toBe(201)
  return signIn(ADMIN.email, ADMIN.password)
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await request('/api/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  expect(response.status).toBe(200)
  const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(';')[0])
  expect(cookies.length).toBeGreaterThan(0)
  return cookies.join('; ')
}

describe('onboarding', () => {
  it('reports uninitialized, creates the first admin once, then locks', async () => {
    expect(await (await request('/api/setup/status')).json()).toEqual({ initialized: false })

    const created = await request('/api/setup/admin', { method: 'POST', body: JSON.stringify(ADMIN) })
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({ user: { email: ADMIN.email, role: 'admin' } })

    expect(await (await request('/api/setup/status')).json()).toEqual({ initialized: true })

    const again = await request('/api/setup/admin', { method: 'POST', body: JSON.stringify(ADMIN) })
    expect(again.status).toBe(409)
  })

  it('rejects api access without a session even after setup', async () => {
    await setupAdmin()
    expect((await request('/api/library/states')).status).toBe(401)
  })
})

describe('library resources', () => {
  it('saves, watches, un-watches, and deletes a resource end to end', async () => {
    const cookie = await setupAdmin()
    const resource = { mediaKey: 'tmdb:movie:550', kind: 'movie' }

    const saved = await request('/api/library/resources', {
      method: 'PUT',
      cookie,
      body: JSON.stringify({ ...resource, status: 'saved' }),
    })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ item: { mediaKey: 'tmdb:movie:550', id: 550, kind: 'movie' } })

    const watched = await request('/api/library/resources', {
      method: 'PUT',
      cookie,
      body: JSON.stringify({ ...resource, status: 'watched' }),
    })
    const watchedItem = ((await watched.json()) as { item: { watchedAt: string | null } }).item
    expect(watchedItem.watchedAt).not.toBeNull()

    const states = (await (await request('/api/library/states', { cookie })).json()) as {
      items: Array<{ mediaKey: string }>
    }
    expect(states.items.map((item) => item.mediaKey)).toEqual(['tmdb:movie:550'])

    const deleted = await request(`/api/library/resources/${encodeURIComponent('tmdb:movie:550')}`, {
      method: 'DELETE',
      cookie,
      body: JSON.stringify({ ...resource, status: 'saved' }),
    })
    expect(deleted.status).toBe(200)

    const after = (await (await request('/api/library/states', { cookie })).json()) as { items: unknown[] }
    expect(after.items).toEqual([])
  })

  it('rejects a media key that does not match the body', async () => {
    const cookie = await setupAdmin()
    const response = await request('/api/library/resources/tmdb%3Amovie%3A1', {
      method: 'DELETE',
      cookie,
      body: JSON.stringify({ mediaKey: 'tmdb:movie:2', kind: 'movie', status: 'saved' }),
    })
    expect(response.status).toBe(400)
  })

  it('serves the book/music library kinds without a TMDB source', async () => {
    const cookie = await setupAdmin()
    const response = await request('/api/library?kind=book', { cookie })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ items: [], totalResults: 0 })
  })
})

describe('admin-managed connectors', () => {
  it('runs the media source crud lifecycle', async () => {
    const cookie = await setupAdmin()
    const input = {
      description: 'TMDB main',
      kind: 'tmdb',
      credentials: { apiKey: 'tmdb-key' },
      options: { language: 'en-US' },
      enabled: true,
    }

    const created = await request('/api/media-sources', { method: 'POST', cookie, body: JSON.stringify(input) })
    expect(created.status).toBe(201)
    const { item } = (await created.json()) as { item: { id: string } & Record<string, unknown> }
    expect(item).toMatchObject({ kind: 'tmdb', enabled: true, healthStatus: 'unknown' })
    // Summaries never leak credentials.
    expect(item).not.toHaveProperty('credentials')

    const details = await request(`/api/media-sources/${item.id}`, { cookie })
    expect(await details.json()).toMatchObject({ item: { credentials: { apiKey: 'tmdb-key' } } })

    const updated = await request(`/api/media-sources/${item.id}`, {
      method: 'PATCH',
      cookie,
      body: JSON.stringify({ ...input, enabled: false }),
    })
    expect(await updated.json()).toMatchObject({ item: { enabled: false } })

    const deleted = await request(`/api/media-sources/${item.id}`, { method: 'DELETE', cookie })
    expect(deleted.status).toBe(200)
    expect((await request(`/api/media-sources/${item.id}`, { cookie })).status).toBe(404)
  })

  it('runs the downloader crud lifecycle scoped to the user', async () => {
    const cookie = await setupAdmin()
    const input = {
      description: 'My ZPan',
      kind: 'zpan',
      endpoint: 'http://zpan.local',
      credentials: { apiKey: 'zpan-key' },
      options: { targetFolder: '/media' },
      enabled: true,
    }

    const created = await request('/api/downloaders', { method: 'POST', cookie, body: JSON.stringify(input) })
    expect(created.status).toBe(201)
    const { item } = (await created.json()) as { item: { id: string } }

    const list = (await (await request('/api/downloaders', { cookie })).json()) as { items: Array<{ id: string }> }
    expect(list.items.map((entry) => entry.id)).toEqual([item.id])

    const deleted = await request(`/api/downloaders/${item.id}`, { method: 'DELETE', cookie })
    expect(deleted.status).toBe(200)
  })

  it('hides admin routes from non-admin users', async () => {
    const cookie = await setupAdmin()
    // Demote the signed-in user; the session stays valid but loses the role.
    await env.DB.prepare("UPDATE user SET role = 'user'").run()

    expect((await request('/api/media-sources', { cookie })).status).toBe(403)
    expect((await request('/api/indexers', { cookie })).status).toBe(403)
    // Indexer search stays available to regular users.
    const search = await request('/api/indexers/search?q=dune', { cookie })
    expect(search.status).toBe(503)
    expect(await search.json()).toMatchObject({ code: 'INDEXER_NOT_CONFIGURED' })
  })
})
