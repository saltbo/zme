import { env } from 'cloudflare:test'
import { createIdentityRepo } from '@server/adapters/repos/identity'
import { app } from '@server/app'
import { createDeps } from '@server/composition'
import { createDb } from '@server/db/client'
import { processDownloadReconciliation } from '@server/usecases/downloads'
import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { expect, it, vi } from 'vitest'

it('atomically accepts one concurrent use of a DPoP proof', async () => {
  const repo = createIdentityRepo(createDb(env))
  const now = new Date().toISOString()
  const accepted = await Promise.all(
    Array.from({ length: 8 }, () =>
      repo.recordDpopProof(
        'https://issuer.zme.test',
        'concurrent-proof',
        'concurrent-thumbprint',
        new Date(Date.now() + 300_000).toISOString(),
        now,
      ),
    ),
  )

  expect(accepted.filter(Boolean)).toHaveLength(1)
})

it('enforces DPoP replay, scope, Agent surface, and cross-owner boundaries', async () => {
  const fixture = await dpopFixture()
  vi.stubGlobal('fetch', fixture.fetch)
  const bearer = await app.fetch(
    new Request('https://zme.test/api/media?query=test', {
      headers: { authorization: 'Bearer bearer-is-never-accepted', 'API-Version': '2026-08-05' },
    }),
    fixture.env,
  )
  expect(bearer.status).toBe(401)
  expect(bearer.headers.get('www-authenticate')).toBe(
    'DPoP algs="RS256 RS384 RS512 PS256 PS384 PS512 ES256 ES384 ES512 EdDSA", error="invalid_token"',
  )

  const missingProof = await app.fetch(
    new Request('https://zme.test/api/media?query=test', {
      headers: { authorization: 'DPoP proof-required', 'API-Version': '2026-08-05' },
    }),
    fixture.env,
  )
  expect(missingProof.status).toBe(401)
  expect(missingProof.headers.get('www-authenticate')).toBe(
    'DPoP algs="RS256 RS384 RS512 PS256 PS384 PS512 ES256 ES384 ES512 EdDSA", error="invalid_dpop_proof"',
  )

  const lowercaseSchemeRequest = await fixture.signedRequest('/api/media-sources', ['media:read'])
  const lowercaseSchemeHeaders = new Headers(lowercaseSchemeRequest.headers)
  lowercaseSchemeHeaders.set(
    'authorization',
    lowercaseSchemeHeaders.get('authorization')?.replace(/^DPoP /, 'dpop ') ?? '',
  )
  const lowercaseScheme = await app.fetch(
    new Request(lowercaseSchemeRequest, { headers: lowercaseSchemeHeaders }),
    fixture.env,
  )
  expect(lowercaseScheme.status).toBe(403)
  expect(await lowercaseScheme.json()).toMatchObject({
    type: expect.stringContaining('/problems/agent-operation-forbidden'),
  })

  const wrongBinding = await app.fetch(
    await fixture.signedRequest(
      '/api/media?query=test',
      ['media:read'],
      'different-user',
      'GET',
      undefined,
      undefined,
      true,
    ),
    fixture.env,
  )
  expect(wrongBinding.status).toBe(401)
  expect(wrongBinding.headers.get('www-authenticate')).toBe(
    'DPoP algs="RS256 RS384 RS512 PS256 PS384 PS512 ES256 ES384 ES512 EdDSA", error="invalid_token"',
  )

  const ownerId = crypto.randomUUID()
  const downloadId = crypto.randomUUID()
  const downloaderId = crypto.randomUUID()
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users
        (id, name, oidc_email, role, disabled, issuer, subject, created_at, updated_at)
       VALUES (?, 'Owner', 'owner@idp.test', 'user', 0, ?, 'owner-subject', ?, ?)`,
    ).bind(ownerId, fixture.issuer, Date.now(), Date.now()),
    env.DB.prepare(
      `INSERT INTO downloaders
        (id, user_id, description, kind, endpoint, credentials_json, options_json, enabled, health_status, created_at, updated_at)
       VALUES (?, ?, 'Owner ZPan', 'zpan', 'https://zpan.owner.test', '{}', '{}', 1, 'online', ?, ?)`,
    ).bind(downloaderId, ownerId, new Date().toISOString(), new Date().toISOString()),
    env.DB.prepare(
      `INSERT INTO downloads
        (id, user_id, idempotency_key, request_hash, resource_ref, resource_kind, resource_key, downloader_id, spec_json, status, created_at, updated_at)
       VALUES (?, ?, 'owner-key', 'owner-hash', 'release-ref:v1:owner', 'release', 'tmdb:movie:550', ?, '{}', 'completed', ?, ?)`,
    ).bind(downloadId, ownerId, downloaderId, new Date().toISOString(), new Date().toISOString()),
  ])

  const auditLog = vi.spyOn(console, 'info')
  const crossOwner = await fixture.signedRequest(`/api/downloads/${downloadId}`, ['downloads:read'])
  const deniedByOwnership = await app.fetch(asAppRequest(crossOwner.clone()), fixture.env)
  expect(deniedByOwnership.status).toBe(404)
  expect(deniedByOwnership.headers.get('link')).toBe(
    '<https://zme.test/api/openapi.json>; rel="service-desc"; type="application/openapi+json"',
  )
  const auditEntries = auditLog.mock.calls.map(([entry]) => JSON.parse(String(entry)))
  expect(auditEntries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        principalKind: 'agent',
        actorFingerprint: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        status: 404,
      }),
    ]),
  )
  expect(JSON.stringify(auditEntries)).not.toContain('agent-e2e')
  auditLog.mockRestore()

  const replay = await app.fetch(asAppRequest(crossOwner.clone()), fixture.env)
  expect(replay.status).toBe(401)
  expect(replay.headers.get('www-authenticate')).toBe(
    'DPoP algs="RS256 RS384 RS512 PS256 PS384 PS512 ES256 ES384 ES512 EdDSA", error="invalid_dpop_proof"',
  )

  const insufficient = await app.fetch(
    await fixture.signedRequest(`/api/downloads/${downloadId}`, ['media:read']),
    fixture.env,
  )
  expect(insufficient.status).toBe(403)
  expect(insufficient.headers.get('www-authenticate')).toBe(
    'DPoP algs="RS256 RS384 RS512 PS256 PS384 PS512 ES256 ES384 ES512 EdDSA", error="insufficient_scope", scope="downloads:read"',
  )

  const highRisk = await app.fetch(
    await fixture.signedRequest('/api/media-sources', ['media-sources:write'], 'configured-admin'),
    fixture.env,
  )
  expect(highRisk.status).toBe(403)
  expect(await highRisk.json()).toMatchObject({ type: expect.stringContaining('/problems/agent-operation-forbidden') })
})

it('completes the least-privilege Agent media, release-candidate, and download flow', async () => {
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
    await fixture.signedRequest('/api/downloaders', ['downloaders:read']),
    fixture.env,
  )
  expect(destinationsResponse.status).toBe(200)
  const destinations = (await destinationsResponse.json()) as {
    items: Array<{ id: string; description: string; kind: string; supportedSourceTypes: string[] }>
  }
  expect(destinations.items).toEqual([
    {
      id: downloaderId,
      description: 'ZPan',
      kind: 'zpan',
      endpoint: 'https://zpan.test',
      enabled: true,
      healthStatus: 'online',
      healthMessage: null,
      healthCheckedAt: null,
      createdAt: now,
      updatedAt: now,
      supportedSourceTypes: expect.arrayContaining(['magnet']),
    },
  ])

  const resultsResponse = await app.fetch(
    await fixture.signedRequest(
      `/api/release-candidates?mediaKey=${encodeURIComponent(media.items[0].mediaKey)}&query=Fight%20Club%201999`,
      ['release-candidates:read'],
    ),
    fixture.env,
  )
  expect(resultsResponse.status).toBe(200)
  const results = (await resultsResponse.json()) as {
    items: Array<{
      title: string
      source: string
      sizeBytes: number
      quality: unknown
      encoding: unknown
      availability: unknown
      resourceRef: string
      resourceRefExpiresAt: string
    }>
  }
  expect(results.items[0]).toMatchObject({
    title: 'Fight.Club.1999.1080p.BluRay.x265.DTS',
    resourceRef: expect.stringMatching(/^release-ref:v1:/),
    resourceRefExpiresAt: expect.any(String),
  })

  const taskResponse = await app.fetch(
    await fixture.signedRequest(
      '/api/downloads',
      ['downloads:write'],
      'different-user',
      'POST',
      { resourceRef: results.items[0].resourceRef, downloaderId: destinations.items[0].id },
      'download-flow-1',
    ),
    fixture.env,
  )
  expect(taskResponse.status).toBe(201)
  const task = (await taskResponse.json()) as { id: string; status: string; externalTaskId: string }
  expect(task).toMatchObject({ status: 'submitted', externalTaskId: 'zpan-task-123' })
  const missingPrecondition = await app.fetch(
    await fixture.signedRequest(`/api/downloads/${task.id}/suspension`, ['downloads:manage'], 'different-user', 'PUT'),
    fixture.env,
  )
  expect(missingPrecondition.status).toBe(428)
  const staleRequest = await fixture.signedRequest(
    `/api/downloads/${task.id}/suspension`,
    ['downloads:manage'],
    'different-user',
    'PUT',
  )
  const staleHeaders = new Headers(staleRequest.headers)
  staleHeaders.set('If-Match', '"stale"')
  const staleResponse = await app.fetch(new Request(staleRequest, { headers: staleHeaders }), fixture.env)
  expect(staleResponse.status).toBe(412)
  const replayResponse = await app.fetch(
    await fixture.signedRequest(
      '/api/downloads',
      ['downloads:write'],
      'different-user',
      'POST',
      { resourceRef: results.items[0].resourceRef, downloaderId: destinations.items[0].id },
      'download-flow-1',
    ),
    fixture.env,
  )
  expect(replayResponse.status).toBe(201)
  expect(await replayResponse.json()).toMatchObject({ id: task.id })
  const conflictResponse = await app.fetch(
    await fixture.signedRequest(
      '/api/downloads',
      ['downloads:write'],
      'different-user',
      'POST',
      { resourceRef: results.items[0].resourceRef, downloaderId: crypto.randomUUID() },
      'download-flow-1',
    ),
    fixture.env,
  )
  expect(conflictResponse.status).toBe(409)
  expect(await conflictResponse.json()).toMatchObject({ type: expect.stringContaining('/idempotency-conflict') })
  expect(submitted).toEqual([
    expect.objectContaining({
      source: { type: 'magnet', uri: 'magnet:?xt=urn:btih:0123456789abcdef' },
      targetFolder: '/media/Movies',
      name: 'Fight.Club.1999.1080p.BluRay.x265.DTS',
      category: 'zme:movie',
      tags: expect.arrayContaining(['mediaKey=tmdb:movie:550', 'kind=movie']),
    }),
  ])

  await expect(
    processDownloadReconciliation(createDeps(fixture.env), {
      type: 'download_reconciliation',
      userId: agentUserId,
      downloadId: task.id,
    }),
  ).resolves.toBeNull()

  const statusResponse = await app.fetch(
    await fixture.signedRequest(`/api/downloads/${task.id}`, ['downloads:read']),
    fixture.env,
  )
  expect(await statusResponse.json()).toMatchObject({
    status: 'completed',
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
    DOWNLOAD_RESOURCE_REF_SECRET: 'dpop-resource-ref-secret',
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
      useWrongBinding = false,
    ) {
      const url = `https://zme.test${path}`
      const { privateKey: proofPrivateKey, publicKey: proofPublicKey } = await generateKeyPair('ES256', {
        extractable: true,
      })
      const proofJwk = await exportJWK(proofPublicKey)
      const bindingJwk = useWrongBinding
        ? await exportJWK((await generateKeyPair('ES256', { extractable: true })).publicKey)
        : proofJwk
      const thumbprint = await calculateJwkThumbprint(bindingJwk)
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
        'API-Version': '2026-08-05',
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
