import { env } from 'cloudflare:test'
import { createIdentityRepo } from '@server/adapters/repos/identity'
import { app } from '@server/app'
import { createDeps } from '@server/composition'
import { createDb } from '@server/db/client'
import { issueTorrentResourceRef } from '@server/security/download-resource-ref'
import { processDownloadReconciliation } from '@server/usecases/downloads'
import type { IndexerSearchItem, LocalDownload } from '@shared/types'
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

it('lets Agents read book and music catalogs and their own library with the declared scopes', async () => {
  const fixture = await dpopFixture()
  fixture.setUpstreamFetch(async (request) => {
    const url = new URL(request.url)
    if (url.hostname === 'openlibrary.org' && url.pathname === '/search.json')
      return json({
        numFound: 1,
        docs: [{ key: '/works/OL1W', title: 'Fixture Book', author_name: ['Fixture Author'] }],
      })
    if (url.hostname === 'musicbrainz.org' && url.pathname.includes('/release-group'))
      return json({
        'release-groups': [
          {
            id: '12345678-1234-4234-8234-123456789abc',
            title: 'Fixture Album',
            'primary-type': 'Album',
            'artist-credit': [],
          },
        ],
      })
    return new Response(null, { status: 404 })
  })
  vi.stubGlobal('fetch', fixture.fetch)
  for (const path of ['/api/catalog/books?q=Fixture', '/api/catalog/albums?q=Fixture']) {
    const response = await app.fetch(await fixture.signedRequest(path, ['media:read']), fixture.env)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { items: Array<{ title: string }>; pagination: { totalItems: number } }
    expect(body.items).toHaveLength(1)
    expect(body.items[0].title).toContain('Fixture')
    if (path.startsWith('/api/catalog/books')) expect(body.pagination.totalItems).toBe(1)
    else expect(body.pagination).not.toHaveProperty('totalItems')
  }
  const denied = await app.fetch(
    await fixture.signedRequest('/api/library/items?kind=book', ['media:read']),
    fixture.env,
  )
  expect(denied.status).toBe(403)
  const library = await app.fetch(
    await fixture.signedRequest('/api/library/items?kind=book', ['library:read']),
    fixture.env,
  )
  expect(library.status).toBe(200)
  expect(await library.json()).toMatchObject({ items: [], pagination: { totalItems: 0 } })
  const collections = await app.fetch(
    await fixture.signedRequest('/api/library/music/collections?kind=playlist', ['library:read']),
    fixture.env,
  )
  expect(collections.status).toBe(200)
  expect(await collections.json()).toEqual({ items: [] })
})

it('enforces DPoP replay, scope, Agent surface, and cross-owner boundaries', async () => {
  const fixture = await dpopFixture()
  vi.stubGlobal('fetch', fixture.fetch)
  const bearer = await app.fetch(
    new Request('https://zme.test/api/catalog/items?q=test', {
      headers: { authorization: 'Bearer bearer-is-never-accepted' },
    }),
    fixture.env,
  )
  expect(bearer.status).toBe(401)
  expect(bearer.headers.get('www-authenticate')).toBe(
    'DPoP algs="RS256 RS384 RS512 PS256 PS384 PS512 ES256 ES384 ES512 EdDSA", error="invalid_token"',
  )

  const missingProof = await app.fetch(
    new Request('https://zme.test/api/catalog/items?q=test', {
      headers: { authorization: 'DPoP proof-required' },
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
      '/api/catalog/items?q=test',
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
       VALUES (?, ?, 'owner-key', 'owner-hash', 'torrent-ref:v1:owner', 'release', 'tmdb:movie:550', ?, '{}', 'completed', ?, ?)`,
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

it('completes the least-privilege Agent media, torrent, and download flow', async () => {
  const fixture = await dpopFixture()
  const mediaSourceId = crypto.randomUUID()
  const indexerId = crypto.randomUUID()
  const downloaderId = crypto.randomUUID()
  const agentUserId = crypto.randomUUID()
  const now = new Date().toISOString()
  let indexerSearchRequests = 0
  const submitted: unknown[] = []
  fixture.setUpstreamFetch(async (request) => {
    const url = new URL(request.url)
    if (url.hostname === 'api.themoviedb.org' && url.pathname.includes('/genre/')) {
      return json({ genres: [{ id: 18, name: 'Drama' }] })
    }
    if (url.hostname === 'api.themoviedb.org' && url.pathname === '/3/search/movie') {
      return json({
        page: 1,
        total_pages: 1,
        total_results: 1,
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
      indexerSearchRequests += 1
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
        {
          guid: 'nzb-1',
          title: 'Not a BT source',
          indexer: 'Example Tracker',
          protocol: 'usenet',
          downloadUrl: 'https://tracker.test/file.nzb',
        },
      ])
    }
    if (url.origin === 'https://zpan.test' && url.pathname === '/api/downloads/tasks') {
      if (request.method === 'POST') {
        submitted.push(await request.json())
        return json({ id: 'zpan-task-123' })
      }
    }
    if (url.origin === 'https://tracker.test' && url.pathname === '/file') {
      return new Response(null, { status: 302, headers: { location: '/signed?passkey=private' } })
    }
    if (url.origin === 'https://tracker.test' && url.pathname === '/signed') {
      return new Response('d4:infod4:name4:testee', {
        headers: { 'content-type': 'application/x-bittorrent', 'set-cookie': 'private=secret' },
      })
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
    await fixture.signedRequest('/api/catalog/items?q=Fight%20Club&types=movie', ['media:read']),
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

  const downloaderDetail = await app.fetch(
    await fixture.signedRequest(`/api/downloaders/${downloaderId}`, ['downloaders:read']),
    fixture.env,
  )
  expect(downloaderDetail.status).toBe(200)
  const safeDownloader = await downloaderDetail.json()
  expect(safeDownloader).toMatchObject({ id: downloaderId, configuredCredentials: ['apiKey'] })
  expect(safeDownloader).not.toHaveProperty('credentials')
  expect(JSON.stringify(safeDownloader)).not.toContain('zpan-test')

  const resultsResponse = await app.fetch(
    await fixture.signedRequest(
      `/api/torrents?mediaKey=${encodeURIComponent(media.items[0].mediaKey)}&q=Fight%20Club%201999`,
      ['torrents:read'],
    ),
    fixture.env,
  )
  expect(resultsResponse.status).toBe(200)
  const results = (await resultsResponse.json()) as {
    pagination: { snapshotId: string; totalItems: number }
    items: Array<{
      id: string
      title: string
      quality: unknown
      availability: unknown
      links: { self: string }
      resourceRef?: string
      resourceRefExpiresAt?: string
    }>
  }
  expect(results.items[0]).toMatchObject({
    id: expect.stringMatching(/^torrent:[0-9a-f]{64}$/),
    title: 'Fight.Club.1999.1080p.BluRay.x265.DTS',
    quality: {
      resolution: '1080p',
      source: 'bluray',
      codec: 'x265',
      audio: 'DTS',
      tier: 'good',
      warnings: [],
    },
    availability: { tier: 'high' },
    links: { self: expect.stringContaining('/api/torrents/torrent%3A') },
  })
  expect(results.items[0]).not.toHaveProperty('resourceRef')
  expect(results.items[0]).not.toHaveProperty('resourceRefExpiresAt')
  expect(results.items[0]).not.toHaveProperty('magnetUrl')
  expect(results.items[0]).not.toHaveProperty('downloadUrl')
  expect(results.items[0]).not.toHaveProperty('infoHash')
  expect(results.items[0]).not.toHaveProperty('seeders')
  expect(results.pagination.totalItems).toBe(1)
  const searchesAfterFirstPage = indexerSearchRequests
  const cachedQuery = `/api/torrents?q=Fight%20Club%201999&snapshotId=${results.pagination.snapshotId}&page=2`
  const cachedPage = await app.fetch(await fixture.signedRequest(cachedQuery, ['torrents:read']), fixture.env)
  expect(cachedPage.status).toBe(200)
  expect(await cachedPage.json()).toMatchObject({
    items: [],
    pagination: { page: 2, totalItems: 1, snapshotId: results.pagination.snapshotId },
  })
  expect(indexerSearchRequests).toBe(searchesAfterFirstPage)
  expect(
    (
      await app.fetch(
        await fixture.signedRequest(cachedQuery.replace('Fight%20Club%201999', 'Other'), ['torrents:read']),
        fixture.env,
      )
    ).status,
  ).toBe(409)
  expect(
    (await app.fetch(await fixture.signedRequest(cachedQuery, ['torrents:read'], 'another-user'), fixture.env)).status,
  ).toBe(404)
  expect(
    (
      await app.fetch(
        await fixture.signedRequest('/api/torrents?q=Fight&searchType=search', ['torrents:read']),
        fixture.env,
      )
    ).status,
  ).toBe(422)
  expect(indexerSearchRequests).toBe(searchesAfterFirstPage)

  const fullResultsResponse = await app.fetch(
    await fixture.signedRequest(
      `/api/torrents?mediaKey=${encodeURIComponent(media.items[0].mediaKey)}&q=Fight%20Club%201999&view=full`,
      ['torrents:read'],
    ),
    fixture.env,
  )
  expect(fullResultsResponse.status).toBe(200)
  const fullResults = (await fullResultsResponse.json()) as { items: Array<Record<string, unknown>> }
  expect(fullResults.items[0]).toMatchObject({
    id: results.items[0].id,
    seeders: 42,
    leechers: 3,
    sourceType: 'magnet',
  })
  expect(fullResults.items[0]).not.toHaveProperty('resourceRef')
  expect(fullResults.items[0]).not.toHaveProperty('magnetUrl')
  expect(fullResults.items[0]).not.toHaveProperty('downloadUrl')
  expect(fullResults.items[0]).not.toHaveProperty('infoHash')

  const candidateUrl = new URL(results.items[0].links.self)
  const searchRequestsBeforeCandidateGet = indexerSearchRequests
  const candidateResponse = await app.fetch(
    await fixture.signedRequest(`${candidateUrl.pathname}?mediaKey=${encodeURIComponent(media.items[0].mediaKey)}`, [
      'torrents:read',
    ]),
    fixture.env,
  )
  expect(candidateResponse.status).toBe(200)
  expect(indexerSearchRequests).toBe(searchRequestsBeforeCandidateGet)
  const candidate = (await candidateResponse.json()) as { resourceRef: string; resourceRefExpiresAt: string }
  expect(candidate).toMatchObject({
    resourceRef: expect.stringMatching(/^torrent-ref:v1:/),
    resourceRefExpiresAt: expect.any(String),
  })

  const localResponse = await app.fetch(
    await fixture.signedRequest('/api/downloads', ['downloads:write'], 'different-user', 'POST', {
      resourceRef: candidate.resourceRef,
    }),
    fixture.env,
  )
  expect(localResponse.status).toBe(201)
  expect(await localResponse.json()).toMatchObject({
    kind: 'magnet',
    href: 'magnet:?xt=urn:btih:0123456789abcdef',
  })
  expect(submitted).toEqual([])
  const insufficientLocal = await app.fetch(
    await fixture.signedRequest('/api/downloads', ['downloads:read'], 'different-user', 'POST', {
      resourceRef: candidate.resourceRef,
    }),
    fixture.env,
  )
  expect(insufficientLocal.status).toBe(403)

  const torrentReference = await issueTorrentResourceRef(
    fixture.env.DOWNLOAD_RESOURCE_REF_SECRET,
    agentUserId,
    'tmdb:movie:550',
    {
      title: 'Local torrent',
      downloadUrl: 'https://tracker.test/file',
      magnetUrl: null,
      downloadTarget: null,
    } as IndexerSearchItem,
  )
  const torrentResponse = await app.fetch(
    await fixture.signedRequest('/api/downloads', ['downloads:write'], 'different-user', 'POST', {
      resourceRef: torrentReference.resourceRef,
    }),
    fixture.env,
  )
  expect(torrentResponse.status).toBe(201)
  const torrentSource = (await torrentResponse.json()) as LocalDownload
  expect(JSON.stringify(torrentSource)).not.toContain('tracker.test')
  const content = await app.fetch(new Request(torrentSource.href), fixture.env)
  expect(content.status).toBe(200)
  expect(content.headers.has('location')).toBe(false)
  expect(content.headers.has('set-cookie')).toBe(false)
  expect(await content.text()).toBe('d4:infod4:name4:testee')
  expect(submitted).toEqual([])

  const taskResponse = await app.fetch(
    await fixture.signedRequest(
      '/api/downloads',
      ['downloads:write'],
      'different-user',
      'POST',
      { resourceRef: candidate.resourceRef, downloaderId: destinations.items[0].id },
      'download-flow-1',
    ),
    fixture.env,
  )
  expect(taskResponse.status).toBe(201)
  const task = (await taskResponse.json()) as { id: string; status: string; externalTaskId: string }
  expect(task).toMatchObject({ status: 'submitted', externalTaskId: 'zpan-task-123' })
  const replayResponse = await app.fetch(
    await fixture.signedRequest(
      '/api/downloads',
      ['downloads:write'],
      'different-user',
      'POST',
      { resourceRef: candidate.resourceRef, downloaderId: destinations.items[0].id },
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
      { resourceRef: candidate.resourceRef, downloaderId: crypto.randomUUID() },
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
      tags: ['tmdbId=550'],
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
    await fixture.signedRequest('/api/catalog/items?q=test', ['media:read'], 'disabled-subject'),
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
        act: { sub: 'agent-e2e', iss: issuer },
        client_id: 'realmroot-cli',
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
