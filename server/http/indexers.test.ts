import type { Env } from '@server/env'
import type { IndexerSearchItem } from '@shared/types'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { AppEnv } from './context'
import { registerTorrentRoutes, serializeTorrent } from './torrents'

const secret = 'torrent-serialization-test-secret'
const item: IndexerSearchItem = {
  id: 'candidate-1',
  downloadTarget: null,
  title: 'Test Movie 2026 1080p WEB-DL',
  fileName: 'test-movie.torrent',
  indexer: 'Private Indexer',
  size: 1_000,
  seeders: 10,
  leechers: 1,
  files: 1,
  protocol: 'torrent',
  publishDate: null,
  downloadUrl: 'https://example.test/test-movie.torrent',
  magnetUrl: null,
  infoUrl: null,
  infoHash: 'abc',
  categories: ['Movies'],
  categoryIds: [2000],
  indexerFlags: [],
  imdbId: null,
  tmdbId: 123,
  tvdbId: null,
}

describe('torrent serialization', () => {
  it('rejects a book search without an explicit target before contacting an indexer', async () => {
    const app = new Hono<AppEnv>()
    registerTorrentRoutes(app)
    const env = {
      PUBLIC_APP_ORIGIN: 'https://zme.test',
      OIDC_ISSUER: 'https://id.test',
      OIDC_CLIENT_ID: 'test',
      OIDC_ADMIN_SUBJECTS: 'admin',
    } as Env
    const response = await app.request('/torrents?mediaKey=openlibrary%3Awork%3AOL1W&q=Book', undefined, env)
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ status: 422, type: 'https://zme.test/problems/validation-error' })
  })

  it('omits the indexer and resource reference from the default compact view', async () => {
    const candidate = await serializeTorrent(secret, 'user-1', 'tmdb:movie:123', item, undefined, 'compact')

    expect(candidate).not.toHaveProperty('indexer')
    expect(candidate).not.toHaveProperty('resourceRef')
    expect(candidate.links.self).toMatch(/^\/api\/torrents\/torrent:/)
  })

  it('includes the indexer in the full view without exposing the resource reference', async () => {
    const candidate = await serializeTorrent(secret, 'user-1', 'tmdb:movie:123', item, undefined, 'full')

    expect(candidate).toHaveProperty('indexer', 'Private Indexer')
    expect(candidate).not.toHaveProperty('resourceRef')
  })

  it('includes the resource reference only for direct candidate retrieval', async () => {
    const candidate = await serializeTorrent(secret, 'user-1', 'tmdb:movie:123', item, undefined, 'compact', {
      includeResourceRef: true,
    })

    expect(candidate.resourceRef).toMatch(/^torrent-ref:v1:/)
    expect(candidate.resourceRefExpiresAt).toEqual(expect.any(String))
  })
})
