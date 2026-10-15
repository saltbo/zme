import { encryptConnectorCredentials } from '@server/domain/connector-credentials'
import type { Env } from '@server/env'
import { issueTorrentResourceRef } from '@server/security/download-resource-ref'
import { issueLocalDownloadTicket } from '@server/security/local-download-ticket'
import type { Deps } from '@server/usecases/deps'
import { LocalDownloadUnavailableError } from '@server/usecases/local-downloads'
import type { IndexerSearchItem, LocalDownload } from '@shared/types'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from './context'
import { registerDownloadRoutes } from './downloads'
import { registerPublicLocalDownloadRoutes } from './local-downloads'

const secret = 'local-download-source-test-secret'
const env = {
  PUBLIC_APP_ORIGIN: 'https://zme.test',
  OIDC_ISSUER: 'https://id.test',
  OIDC_CLIENT_ID: 'zme',
  OIDC_ADMIN_SUBJECTS: 'admin',
  DOWNLOAD_RESOURCE_REF_SECRET: secret,
  CONNECTOR_CREDENTIALS_SECRET: secret,
} as Env
const torrent = new TextEncoder().encode('d4:infod4:name4:testee')

afterEach(() => vi.unstubAllGlobals())

function fixture(userId = 'user-1', extraDeps: Partial<Deps> = {}) {
  const gateway = { torrent: vi.fn(async () => torrent) }
  const deps = {
    indexersRepo: { listEnabled: async () => [] },
    downloadSourceContent: gateway,
    ...extraDeps,
  } as unknown as Deps
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('deps', deps)
    await next()
  })
  registerPublicLocalDownloadRoutes(app)
  app.use('*', async (c, next) => {
    c.set('principal', { kind: 'human', userId, issuer: '', subject: '', role: 'user', scopes: ['*'] })
    await next()
  })
  registerDownloadRoutes(app)
  return {
    gateway,
    request: (path: string, init?: RequestInit) => app.fetch(new Request(`https://zme.test${path}`, init), env),
    create: (resourceRef: string) =>
      app.fetch(
        new Request('https://zme.test/downloads', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ resourceRef }),
        }),
        env,
      ),
  }
}

describe('local download source HTTP contract', () => {
  it('delivers owned music as an attachment without exposing the provider URL or requiring a downloader', async () => {
    const track = {
      id: 'track-1',
      provider: 'netease',
      externalId: '123',
      mediaKey: 'netease:track:123',
      title: 'Song',
      artists: ['Artist'],
      release: null,
      coverUrl: null,
    }
    const encrypted = await encryptConnectorCredentials(secret, ['MUSIC_U=fake-session'])
    const getLibraryTrack = vi.fn(async (userId: string) => (userId === 'user-1' ? track : null))
    const musicDeps = {
      musicCollectionsRepo: {
        getTrackByMediaKey: async () => track,
        getLibraryTrack,
        setTrackAvailabilities: async () => undefined,
      },
      connectorsRepo: {
        findByKind: async () => ({
          id: 'connector-1',
          kind: 'netease',
          enabled: true,
          status: 'connected',
          credentialsEncrypted: encrypted,
        }),
      },
      musicConnectors: new Map([
        [
          'netease',
          {
            definition: { capabilities: ['music.tracks.download'] },
            open: () => ({
              resolve: async () => ({
                url: 'https://private-cdn.test/song.mp3',
                headers: { referer: 'https://music.test/' },
                quality: 'exhigh',
                extension: 'mp3',
                contentType: 'audio/mpeg',
                contentLength: 5,
              }),
            }),
          },
        ],
      ]),
    } as unknown as Partial<Deps>
    const fetch = vi.fn(async () => new Response('audio', { headers: { 'content-type': 'audio/mpeg' } }))
    vi.stubGlobal('fetch', fetch)
    const f = fixture('user-1', musicDeps)
    const created = await f.create('music-track:netease:track:123')
    expect(created.status).toBe(201)
    const source = (await created.json()) as LocalDownload
    expect(source.kind).toBe('file')
    if (source.kind !== 'file') throw new Error('Expected a file link')
    expect(source.filename).toMatch(/\.mp3$/)
    expect(JSON.stringify(source)).not.toContain('private-cdn')
    const response = await f.request(`/downloads/${source.id}/content`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('audio')
    expect(response.headers.has('location')).toBe(false)
    expect(response.headers.get('content-disposition')).toContain('.mp3')
    expect((await fixture('other-user', musicDeps).create('music-track:netease:track:123')).status).toBe(404)
  })

  it('returns the exact magnet without requiring any configured downloader', async () => {
    const issued = await issueTorrentResourceRef(secret, 'user-1', 'tmdb:movie:550', release('magnet:?xt=urn:btih:abc'))
    const f = fixture()
    const response = await f.create(issued.resourceRef)
    expect(response.status).toBe(201)
    const source = (await response.json()) as LocalDownload
    expect(source).toMatchObject({ kind: 'magnet', href: 'magnet:?xt=urn:btih:abc' })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(source.links.self).toBe(`https://zme.test/api/downloads/${encodeURIComponent(source.id)}`)
    expect(response.headers.get('location')).toBe(source.links.self)
    const read = await f.request(`/downloads/${encodeURIComponent(source.id)}`)
    expect(read.status).toBe(200)
    expect(await read.json()).toEqual(source)
    const content = await f.request(`/downloads/${source.id}/content`)
    expect(content.status).toBe(404)
    expect(f.gateway.torrent).not.toHaveBeenCalled()
  })

  it('validates an explicit downloader instead of silently starting a local download', async () => {
    const f = fixture()
    for (const downloaderId of ['', null, 'not-a-uuid']) {
      const response = await f.request('/downloads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resourceRef: 'opaque', downloaderId }),
      })
      expect(response.status).toBe(422)
    }
    const remote = await f.request('/downloads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resourceRef: 'opaque', downloaderId: crypto.randomUUID() }),
    })
    expect(remote.status).toBe(400)
    expect(await remote.json()).toMatchObject({ title: 'Idempotency-Key is required for remote downloads' })
    expect(f.gateway.torrent).not.toHaveBeenCalled()
  })

  it('conceals the upstream URL in an encrypted file capability and proxies the file without a session', async () => {
    const original = 'https://private-tracker.test/download?passkey=secret'
    const issued = await issueTorrentResourceRef(secret, 'user-1', 'tmdb:movie:550', release(original))
    const f = fixture()
    const created = await f.create(issued.resourceRef)
    const source = (await created.json()) as LocalDownload
    expect(source.kind).toBe('file')
    expect(source.href).toMatch(/^https:\/\/zme.test\/api\/downloads\/.+\/content$/)
    expect(JSON.stringify(source)).not.toContain('private-tracker')
    expect(JSON.stringify(source)).not.toContain('passkey')
    const response = await f.request(`/downloads/${source.id}/content`)
    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(torrent)
    expect(response.headers.get('content-type')).toBe('application/x-bittorrent')
    expect(response.headers.get('content-disposition')).toContain(encodeURIComponent('中文电影.torrent'))
    expect(response.headers.has('location')).toBe(false)
    expect(f.gateway.torrent).toHaveBeenCalledWith(original)
    const other = fixture('other-user')
    expect((await other.request(`/downloads/${source.id}`)).status).toBe(404)
  })

  it('rejects another owner, client-supplied URLs, tampered and expired capabilities', async () => {
    const issued = await issueTorrentResourceRef(
      secret,
      'user-1',
      'tmdb:movie:550',
      release('https://tracker.test/file'),
    )
    expect((await fixture('other-user').create(issued.resourceRef)).status).toBe(422)
    expect((await fixture().create('https://arbitrary.test/file')).status).toBe(422)
    expect((await fixture().request('/downloads/modified/content')).status).toBe(410)
    const expired = await issueLocalDownloadTicket(
      secret,
      {
        userId: 'user-1',
        resourceRef: '',
        sourceType: 'torrent_url',
        uri: 'https://tracker.test/file',
        filename: 'file.torrent',
      },
      new Date(Date.now() - 6 * 60_000),
    )
    expect((await fixture().request(`/downloads/${expired.id}/content`)).status).toBe(410)
  })

  it('returns a safe upstream failure without leaking the source URL', async () => {
    const issued = await issueTorrentResourceRef(
      secret,
      'user-1',
      'tmdb:movie:550',
      release('https://tracker.test/file'),
    )
    const f = fixture()
    f.gateway.torrent.mockRejectedValue(
      new LocalDownloadUnavailableError('The torrent file could not be downloaded.', {
        cause: new Error('https://tracker.test/file?secret=passkey'),
      }),
    )
    const source = (await (await f.create(issued.resourceRef)).json()) as LocalDownload
    const response = await f.request(`/downloads/${source.id}/content`)
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('tracker.test')
    expect(response.headers.has('location')).toBe(false)
  })
})

function release(uri: string): IndexerSearchItem {
  return {
    id: 'release-1',
    downloadTarget: null,
    title: '中文电影',
    fileName: null,
    indexer: 'test',
    size: 100,
    seeders: 1,
    leechers: 0,
    files: 1,
    protocol: 'torrent',
    publishDate: null,
    downloadUrl: uri.startsWith('magnet:') ? null : uri,
    magnetUrl: uri.startsWith('magnet:') ? uri : null,
    infoUrl: null,
    infoHash: null,
    categories: [],
    categoryIds: [],
    indexerFlags: [],
    imdbId: null,
    tmdbId: 550,
    tvdbId: null,
  }
}
