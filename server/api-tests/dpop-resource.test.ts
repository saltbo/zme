import { env } from 'cloudflare:test'
import { app } from '@server/app'
import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { expect, it, vi } from 'vitest'

it('enforces DPoP replay, scope, Agent surface, and cross-owner boundaries', async () => {
  const fixture = await dpopFixture()
  vi.stubGlobal('fetch', fixture.fetch)
  const bearer = await app.fetch(
    new Request('https://zme.test/api/media?query=test', {
      headers: { authorization: 'Bearer bearer-is-never-accepted', 'API-Version': '2026-08-04' },
    }),
    fixture.env,
  )
  expect(bearer.status).toBe(401)
  expect(bearer.headers.get('www-authenticate')).toBe('DPoP error="invalid_token"')

  const missingProof = await app.fetch(
    new Request('https://zme.test/api/media?query=test', {
      headers: { authorization: 'DPoP proof-required', 'API-Version': '2026-08-04' },
    }),
    fixture.env,
  )
  expect(missingProof.status).toBe(401)
  expect(missingProof.headers.get('www-authenticate')).toBe('DPoP error="invalid_dpop_proof"')

  const ownerId = crypto.randomUUID()
  const jobId = crypto.randomUUID()
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users
        (id, name, oidc_email, role, disabled, issuer, subject, created_at, updated_at)
       VALUES (?, 'Owner', 'owner@idp.test', 'user', 0, ?, 'owner-subject', ?, ?)`,
    ).bind(ownerId, fixture.issuer, Date.now(), Date.now()),
    env.DB.prepare(
      `INSERT INTO release_search_jobs
        (id, user_id, idempotency_key, request_hash, media_key, media_title, query, search_type, categories_json, status, created_at)
       VALUES (?, ?, 'owner-key', 'owner-hash', 'tmdb:movie:550', 'Fight Club', 'Fight Club', 'search', '[]', 'completed', ?)`,
    ).bind(jobId, ownerId, new Date().toISOString()),
  ])

  const auditLog = vi.spyOn(console, 'info')
  const crossOwner = await fixture.signedRequest(`/api/release-search-jobs/${jobId}`, ['release-search-jobs:read'])
  const deniedByOwnership = await app.fetch(asAppRequest(crossOwner.clone()), fixture.env)
  expect(deniedByOwnership.status).toBe(404)
  expect(deniedByOwnership.headers.get('link')).toBe(
    '<https://zme.test/api/openapi.json>; rel="service-desc"; type="application/openapi+json"',
  )
  expect(auditLog.mock.calls.map(([entry]) => JSON.parse(String(entry)))).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ principalKind: 'agent', actorSubject: 'agent-e2e', status: 404 }),
    ]),
  )
  auditLog.mockRestore()

  const replay = await app.fetch(asAppRequest(crossOwner.clone()), fixture.env)
  expect(replay.status).toBe(401)
  expect(replay.headers.get('www-authenticate')).toBe('DPoP error="invalid_dpop_proof"')

  const insufficient = await app.fetch(
    await fixture.signedRequest(`/api/release-search-jobs/${jobId}`, ['media:read']),
    fixture.env,
  )
  expect(insufficient.status).toBe(403)
  expect(insufficient.headers.get('www-authenticate')).toBe(
    'DPoP error="insufficient_scope", scope="release-search-jobs:read"',
  )

  const highRisk = await app.fetch(
    await fixture.signedRequest('/api/media-sources', ['media-sources:write'], 'configured-admin'),
    fixture.env,
  )
  expect(highRisk.status).toBe(403)
  expect(await highRisk.json()).toMatchObject({ type: expect.stringContaining('/problems/agent-operation-forbidden') })
})

it('completes the least-privilege Agent media, release-search, and download-task flow', async () => {
  const fixture = await dpopFixture()
  const mediaSourceId = crypto.randomUUID()
  const indexerId = crypto.randomUUID()
  const downloaderId = crypto.randomUUID()
  const agentUserId = crypto.randomUUID()
  const now = new Date().toISOString()
  const submitted: unknown[] = []
  fixture.setUpstreamFetch(async (request) => {
    const url = new URL(request.url)
    if (url.hostname === 'api.themoviedb.org' && url.pathname.includes('/genre/')) {
      return json({ genres: [{ id: 18, name: 'Drama' }] })
    }
    if (url.hostname === 'api.themoviedb.org' && url.pathname === '/3/search/multi') {
      return json({
        results: [
          {
            id: 550,
            media_type: 'movie',
            title: 'Fight Club',
            overview: 'An insomniac meets a soap maker.',
            release_date: '1999-10-15',
            genre_ids: [18],
          },
        ],
      })
    }
    if (url.origin === 'https://prowlarr.test' && url.pathname === '/api/v1/search') {
      return json([
        {
          guid: 'release-1',
          title: 'Fight.Club.1999.1080p.BluRay.x265.DTS',
          indexer: 'Example Tracker',
          size: 8_589_934_592,
          seeders: 42,
          leechers: 3,
          protocol: 'torrent',
          publishDate: '2026-08-01T00:00:00.000Z',
          magnetUrl: 'magnet:?xt=urn:btih:0123456789abcdef',
        },
      ])
    }
    if (url.origin === 'https://zpan.test' && url.pathname === '/api/downloads/tasks') {
      if (request.method === 'POST') {
        submitted.push(await request.json())
        return json({ id: 'zpan-task-123' })
      }
    }
    if (url.origin === 'https://zpan.test' && url.pathname === '/api/downloads/tasks/zpan-task-123') {
      return json({
        id: 'zpan-task-123',
        spec: {
          source: { type: 'magnet', uri: 'magnet:?xt=urn:btih:0123456789abcdef' },
          destination: { name: 'Fight Club 1999', folder: '/media/Movies' },
          labels: { category: 'zme:movie', tags: [] },
        },
        status: {
          state: 'completed',
          progress: {
            download: { bytes: 8_589_934_592, totalBytes: 8_589_934_592, bytesPerSecond: 0 },
            upload: { bytes: 8_589_934_592, totalBytes: 8_589_934_592, bytesPerSecond: 0 },
          },
          output: { objectId: 'zpan-object-123' },
          runtime: {},
          error: null,
          updatedAt: '2026-08-01T00:05:00.000Z',
        },
      })
    }
    return new Response(null, { status: 404 })
  })
  vi.stubGlobal('fetch', fixture.fetch)
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO media_sources
        (id, description, kind, credentials_json, options_json, enabled, health_status, created_at, updated_at)
       VALUES (?, 'TMDB', 'tmdb', '{"apiKey":"tmdb-test"}', '{"language":"en-US"}', 1, 'online', ?, ?)`,
    ).bind(mediaSourceId, now, now),
    env.DB.prepare(
      `INSERT INTO indexers
        (id, description, kind, endpoint, credentials_json, options_json, enabled, health_status, created_at, updated_at)
       VALUES (?, 'Prowlarr', 'prowlarr', 'https://prowlarr.test', '{"apiKey":"prowlarr-test"}', '{}', 1, 'online', ?, ?)`,
    ).bind(indexerId, now, now),
    env.DB.prepare(
      `INSERT INTO users
        (id, name, role, disabled, issuer, subject, created_at, updated_at)
       VALUES (?, 'Agent owner', 'user', 0, ?, 'different-user', ?, ?)`,
    ).bind(agentUserId, fixture.issuer, Date.now(), Date.now()),
    env.DB.prepare(
      `INSERT INTO downloaders
        (id, user_id, description, kind, endpoint, credentials_json, options_json, enabled, health_status, created_at, updated_at)
       VALUES (?, ?, 'ZPan', 'zpan', 'https://zpan.test', '{"apiKey":"zpan-test"}', '{"targetFolder":"/media"}', 1, 'online', ?, ?)`,
    ).bind(downloaderId, agentUserId, now, now),
  ])

  const mediaResponse = await app.fetch(
    await fixture.signedRequest('/api/media?query=Fight%20Club&kind=movie', ['media:read']),
    fixture.env,
  )
  expect(mediaResponse.status).toBe(200)
  const media = (await mediaResponse.json()) as {
    items: Array<{ mediaKey: string; id: number; kind: string; title: string }>
  }
  expect(media).toMatchObject({
    items: [{ mediaKey: 'tmdb:movie:550', id: 550, kind: 'movie', title: 'Fight Club' }],
  })
  expect(await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(agentUserId).first()).toEqual({
    name: 'Agent owner',
  })

  const destinationsResponse = await app.fetch(
    await fixture.signedRequest('/api/download-destinations', ['download-destinations:read']),
    fixture.env,
  )
  expect(destinationsResponse.status).toBe(200)
  const destinations = (await destinationsResponse.json()) as {
    items: Array<{ id: string; name: string; kind: string; supportedSourceTypes: string[] }>
  }
  expect(destinations.items).toEqual([
    {
      id: downloaderId,
      name: 'ZPan',
      kind: 'zpan',
      healthStatus: 'online',
      supportedSourceTypes: expect.arrayContaining(['magnet']),
    },
  ])

  const jobResponse = await app.fetch(
    await fixture.signedRequest(
      '/api/release-search-jobs',
      ['release-search-jobs:write'],
      'different-user',
      'POST',
      { mediaKey: media.items[0].mediaKey, mediaTitle: media.items[0].title, query: 'Fight Club 1999' },
      'job-flow-1',
    ),
    fixture.env,
  )
  expect(jobResponse.status).toBe(201)
  const job = (await jobResponse.json()) as { id: string }
  const resultsResponse = await app.fetch(
    await fixture.signedRequest(`/api/release-search-jobs/${job.id}/results`, ['release-search-jobs:read']),
    fixture.env,
  )
  const results = (await resultsResponse.json()) as {
    items: Array<{
      id: string
      title: string
      source: string
      sizeBytes: number
      quality: unknown
      encoding: unknown
      availability: unknown
    }>
  }
  expect(results.items[0]).toMatchObject({
    title: 'Fight.Club.1999.1080p.BluRay.x265.DTS',
    source: 'Example Tracker',
    sizeBytes: 8_589_934_592,
    quality: { source: 'BluRay', resolution: '1080p' },
    availability: { seeders: 42, leechers: 3, protocol: 'torrent' },
  })

  const taskResponse = await app.fetch(
    await fixture.signedRequest(
      '/api/download-tasks',
      ['download-tasks:write'],
      'different-user',
      'POST',
      { releaseSearchResultId: results.items[0].id, downloaderId: destinations.items[0].id },
      'download-flow-1',
    ),
    fixture.env,
  )
  expect(taskResponse.status).toBe(201)
  const task = (await taskResponse.json()) as { id: string; status: string; externalTaskId: string }
  expect(task).toMatchObject({ status: 'submitted', externalTaskId: 'zpan-task-123' })
  expect(submitted).toHaveLength(1)

  const statusResponse = await app.fetch(
    await fixture.signedRequest(`/api/download-tasks/${task.id}`, ['download-tasks:read']),
    fixture.env,
  )
  expect(await statusResponse.json()).toMatchObject({
    status: 'completed',
    downstreamStatus: 'completed',
    externalTaskId: 'zpan-task-123',
    progress: {
      downloadedBytes: 8_589_934_592,
      storageUploadedBytes: 8_589_934_592,
      totalBytes: 8_589_934_592,
    },
    result: { objectId: 'zpan-object-123', name: 'Fight Club 1999', targetFolder: '/media/Movies' },
  })
})

it('intersects Agent scope with a disabled local identity projection', async () => {
  const fixture = await dpopFixture()
  vi.stubGlobal('fetch', fixture.fetch)
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO users
      (id, name, role, disabled, issuer, subject, created_at, updated_at)
     VALUES (?, 'Disabled', 'admin', 1, ?, 'disabled-subject', ?, ?)`,
  )
    .bind(crypto.randomUUID(), fixture.issuer, now, now)
    .run()

  const response = await app.fetch(
    await fixture.signedRequest('/api/media?query=test', ['media:read'], 'disabled-subject'),
    fixture.env,
  )
  expect(response.status).toBe(403)
  expect(await response.json()).toMatchObject({ type: expect.stringContaining('/problems/identity-disabled') })
})

async function dpopFixture() {
  const issuer = `https://dpop-${crypto.randomUUID()}.test`
  const { privateKey: issuerPrivateKey, publicKey: issuerPublicKey } = await generateKeyPair('ES256', {
    extractable: true,
  })
  const issuerJwk = {
    ...(await exportJWK(issuerPublicKey)),
    kid: 'dpop-signing-key',
    alg: 'ES256',
    use: 'sig',
  }
  const requestEnv = {
    ...env,
    OIDC_ISSUER: issuer,
    OIDC_ADMIN_SUBJECTS: 'configured-admin',
  }
  let upstreamFetch: ((request: Request) => Promise<Response>) | undefined
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const path = new URL(request.url).pathname
    if (path === '/.well-known/openid-configuration') {
      return json({ issuer, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` })
    }
    if (path === '/jwks') return json({ keys: [issuerJwk] })
    if (upstreamFetch) return upstreamFetch(request)
    return new Response(null, { status: 404 })
  })

  return {
    issuer,
    fetch,
    env: requestEnv,
    setUpstreamFetch(handler: (request: Request) => Promise<Response>) {
      upstreamFetch = handler
    },
    async signedRequest(
      path: string,
      scopes: string[],
      subject = 'different-user',
      method = 'GET',
      body?: unknown,
      idempotencyKey?: string,
    ) {
      const url = `https://zme.test${path}`
      const { privateKey: proofPrivateKey, publicKey: proofPublicKey } = await generateKeyPair('ES256', {
        extractable: true,
      })
      const proofJwk = await exportJWK(proofPublicKey)
      const thumbprint = await calculateJwkThumbprint(proofJwk)
      const now = Math.floor(Date.now() / 1000)
      const accessToken = await new SignJWT({
        scope: scopes.join(' '),
        cnf: { jkt: thumbprint },
        act: { sub: 'agent-e2e' },
        client_id: 'dpop-agent',
      })
        .setProtectedHeader({ alg: 'ES256', kid: 'dpop-signing-key', typ: 'at+jwt' })
        .setIssuer(issuer)
        .setAudience('https://zme.test/api')
        .setSubject(subject)
        .setJti(crypto.randomUUID())
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(issuerPrivateKey)
      const proof = await new SignJWT({
        htm: method,
        htu: new URL(url).origin + new URL(url).pathname,
        ath: await tokenHash(accessToken),
      })
        .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: proofJwk })
        .setJti(crypto.randomUUID())
        .setIssuedAt(now)
        .sign(proofPrivateKey)
      const headers: Record<string, string> = {
        authorization: `DPoP ${accessToken}`,
        dpop: proof,
        'API-Version': '2026-08-04',
      }
      if (body !== undefined) headers['content-type'] = 'application/json'
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
      return new Request(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    },
  }
}

async function tokenHash(token: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
  return btoa(String.fromCharCode(...digest))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
}

function asAppRequest(request: unknown): Parameters<typeof app.fetch>[0] {
  return request as unknown as Parameters<typeof app.fetch>[0]
}
