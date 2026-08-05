import { env } from 'cloudflare:test'
import { app } from '@server/app'
import { hashSecret } from '@server/usecases/identity'
import { describe, expect, it } from 'vitest'

function request(path: string, init?: RequestInit & { cookie?: string }) {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  if (init?.cookie) headers.set('cookie', init.cookie)
  if (path.startsWith('/api/')) headers.set('API-Version', '2026-08-04')
  return app.fetch(new Request(`https://zme.test${path}`, { ...init, headers }), env)
}

async function setupAdmin(): Promise<string> {
  const token = crypto.randomUUID()
  const now = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users
        (id, name, oidc_email, role, disabled, issuer, subject, identity_bound_at, created_at, updated_at)
       VALUES (?, 'Admin', ?, 'admin', 0, ?, ?, ?, ?, ?)`,
    ).bind('admin-user', 'admin@zme.test', 'https://issuer.zme.test', 'admin-subject', now, Date.now(), Date.now()),
    env.DB.prepare(
      `INSERT INTO application_sessions (id, token_hash, user_id, expires_at, created_at, last_seen_at)
       VALUES (?, ?, 'admin-user', ?, ?, ?)`,
    ).bind(crypto.randomUUID(), await hashSecret(token), new Date(Date.now() + 3_600_000).toISOString(), now, now),
  ])
  return `__Host-zme_session=${token}`
}

describe('external identity boundary', () => {
  it('rejects api access without a local application session [spec: auth/api-requires-session]', async () => {
    expect((await request('/api/library/states')).status).toBe(401)
  })

  it('does not advertise version negotiation on unversioned public resources', async () => {
    for (const path of ['/api', '/api/health', '/api/openapi.json']) {
      const response = await request(path)
      expect(response.status).toBe(200)
      expect(response.headers.has('API-Version')).toBe(false)
    }
  })
})

describe('library resources', () => {
  it('saves, watches, un-watches, and deletes a resource end to end', async () => {
    const cookie = await setupAdmin()
    const resource = { mediaKey: 'tmdb:movie:550', kind: 'movie' }

    const saved = await request(`/api/library/resources/${encodeURIComponent(resource.mediaKey)}`, {
      method: 'PUT',
      cookie,
      body: JSON.stringify({ status: 'saved' }),
    })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ item: { mediaKey: 'tmdb:movie:550', id: 550, kind: 'movie' } })

    const watched = await request(`/api/library/resources/${encodeURIComponent(resource.mediaKey)}`, {
      method: 'PUT',
      cookie,
      body: JSON.stringify({ status: 'watched' }),
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
    })
    expect(deleted.status).toBe(200)

    const after = (await (await request('/api/library/states', { cookie })).json()) as { items: unknown[] }
    expect(after.items).toEqual([])
  })

  it('rejects a media key that is not a library resource identity', async () => {
    const cookie = await setupAdmin()
    const response = await request('/api/library/resources/not-a-media-key', {
      method: 'DELETE',
      cookie,
    })
    expect(response.status).toBe(422)
  })

  it('serves the book/music library kinds without a TMDB source [spec: library/book-music-no-tmdb]', async () => {
    const cookie = await setupAdmin()
    const response = await request('/api/library?kind=book', { cookie })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ items: [], totalResults: 0 })
  })
})

describe('admin-managed connectors', () => {
  it('creates and reads an owned connector sync job resource', async () => {
    const cookie = await setupAdmin()
    await env.DB.prepare(
      `INSERT INTO connectors
        (id, user_id, kind, external_account_id, display_name, created_at, updated_at)
       VALUES ('connector-1', 'admin-user', 'douban', 'profile-1', 'Profile 1', '2026-08-04', '2026-08-04')`,
    ).run()

    const noIdempotencyKey = await request('/api/connector-sync-jobs', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ connectorId: 'connector-1' }),
    })
    expect(noIdempotencyKey.status).toBe(400)
    expect(noIdempotencyKey.headers.get('content-type')).toContain('application/problem+json')

    const created = await request('/api/connector-sync-jobs', {
      method: 'POST',
      cookie,
      headers: { 'Idempotency-Key': 'connector-sync-1' },
      body: JSON.stringify({ connectorId: 'connector-1' }),
    })
    expect(created.status).toBe(201)
    const { job } = (await created.json()) as { job: { id: string; connectorId: string; status: string } }
    expect(job).toMatchObject({ connectorId: 'connector-1', status: 'queued' })
    expect(created.headers.get('location')).toBe(`/api/connector-sync-jobs/${job.id}`)

    const fetched = await request(`/api/connector-sync-jobs/${job.id}`, { cookie })
    expect(fetched.status).toBe(200)
    expect(await fetched.json()).toMatchObject({ job: { id: job.id, status: 'queued' } })
    expect(
      await env.DB.prepare('SELECT user_id, connector_id, status FROM connector_sync_jobs WHERE id = ?')
        .bind(job.id)
        .first(),
    ).toEqual({ user_id: 'admin-user', connector_id: 'connector-1', status: 'queued' })

    const retried = await request('/api/connector-sync-jobs', {
      method: 'POST',
      cookie,
      headers: { 'Idempotency-Key': 'connector-sync-1' },
      body: JSON.stringify({ connectorId: 'connector-1' }),
    })
    expect(await retried.json()).toMatchObject({ job: { id: job.id } })
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS total FROM connector_sync_jobs WHERE user_id = ?')
        .bind('admin-user')
        .first(),
    ).toEqual({ total: 1 })

    await env.DB.prepare(
      `INSERT INTO connectors
        (id, user_id, kind, external_account_id, display_name, created_at, updated_at)
       VALUES ('connector-2', 'admin-user', 'netease', 'profile-2', 'Profile 2', '2026-08-04', '2026-08-04')`,
    ).run()
    const conflict = await request('/api/connector-sync-jobs', {
      method: 'POST',
      cookie,
      headers: { 'Idempotency-Key': 'connector-sync-1' },
      body: JSON.stringify({ connectorId: 'connector-2' }),
    })
    expect(conflict.status).toBe(409)
    const missing = await request('/api/connector-sync-jobs', {
      method: 'POST',
      cookie,
      headers: { 'Idempotency-Key': 'connector-sync-missing' },
      body: JSON.stringify({ connectorId: 'missing' }),
    })
    expect(missing.status).toBe(404)

    const otherToken = crypto.randomUUID()
    const now = new Date().toISOString()
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users
          (id, name, role, disabled, issuer, subject, identity_bound_at, created_at, updated_at)
         VALUES ('other-user', 'Other', 'user', 0, 'https://issuer.zme.test', 'other-subject', ?, ?, ?)`,
      ).bind(now, Date.now(), Date.now()),
      env.DB.prepare(
        `INSERT INTO application_sessions (id, token_hash, user_id, expires_at, created_at, last_seen_at)
         VALUES (?, ?, 'other-user', ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        await hashSecret(otherToken),
        new Date(Date.now() + 3_600_000).toISOString(),
        now,
        now,
      ),
    ])
    const crossOwner = await request(`/api/connector-sync-jobs/${job.id}`, {
      cookie: `__Host-zme_session=${otherToken}`,
    })
    expect(crossOwner.status).toBe(404)
    expect(crossOwner.headers.get('content-type')).toContain('application/problem+json')
  })

  it('runs the media source crud lifecycle [spec: admin/media-source-crud]', async () => {
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
    const createdEtag = created.headers.get('etag')
    expect(createdEtag).toMatch(/^".+"$/)
    const { item } = (await created.json()) as { item: { id: string } & Record<string, unknown> }
    expect(item).toMatchObject({ kind: 'tmdb', enabled: true, healthStatus: 'unknown' })
    // Summaries never leak credentials.
    expect(item).not.toHaveProperty('credentials')

    const details = await request(`/api/media-sources/${item.id}`, { cookie })
    expect(details.headers.get('etag')).toBe(createdEtag)
    expect(await details.json()).toMatchObject({ item: { credentials: { apiKey: 'tmdb-key' } } })

    const health = await request(`/api/media-sources/${item.id}/health-observations`, { cookie })
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ items: [] })

    const updated = await request(`/api/media-sources/${item.id}`, {
      method: 'PATCH',
      cookie,
      headers: { 'Content-Type': 'application/merge-patch+json', 'If-Match': createdEtag as string },
      body: JSON.stringify({ enabled: false }),
    })
    expect(await updated.json()).toMatchObject({ item: { enabled: false } })
    const updatedEtag = updated.headers.get('etag')
    expect(updatedEtag).toMatch(/^".+"$/)
    expect(updatedEtag).not.toBe(createdEtag)

    const stale = await request(`/api/media-sources/${item.id}`, {
      method: 'PATCH',
      cookie,
      headers: { 'Content-Type': 'application/merge-patch+json', 'If-Match': createdEtag as string },
      body: JSON.stringify({ enabled: true }),
    })
    expect(stale.status).toBe(412)
    expect(await stale.json()).toMatchObject({
      type: 'https://zme.test/problems/precondition-failed',
      status: 412,
    })

    const deleted = await request(`/api/media-sources/${item.id}`, {
      method: 'DELETE',
      cookie,
      headers: { 'If-Match': updatedEtag as string },
    })
    expect(deleted.status).toBe(204)
    expect((await request(`/api/media-sources/${item.id}`, { cookie })).status).toBe(404)
  })

  it('runs the downloader crud lifecycle scoped to the user [spec: admin/downloader-crud]', async () => {
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
    const createdEtag = created.headers.get('etag')
    const { item } = (await created.json()) as { item: { id: string } }

    const list = (await (await request('/api/downloaders', { cookie })).json()) as { items: Array<{ id: string }> }
    expect(list.items.map((entry) => entry.id)).toEqual([item.id])

    const missingPrecondition = await request(`/api/downloaders/${item.id}`, { method: 'DELETE', cookie })
    expect(missingPrecondition.status).toBe(428)

    const deleted = await request(`/api/downloaders/${item.id}`, {
      method: 'DELETE',
      cookie,
      headers: { 'If-Match': createdEtag as string },
    })
    expect(deleted.status).toBe(204)
  })

  it('hides admin routes from non-admin users [spec: auth/admin-only]', async () => {
    const cookie = await setupAdmin()
    // Demote the signed-in user; the session stays valid but loses the role.
    await env.DB.prepare("UPDATE users SET role = 'user'").run()

    expect((await request('/api/media-sources', { cookie })).status).toBe(403)
    expect((await request('/api/indexers', { cookie })).status).toBe(403)
    // Indexer search stays available to regular users.
    const search = await request('/api/release-candidates?q=dune', { cookie })
    expect(search.status).toBe(503)
    expect(await search.json()).toMatchObject({
      type: 'https://zme.test/problems/http-503',
      status: 503,
      detail: 'No enabled indexers are configured.',
    })
  })
})
