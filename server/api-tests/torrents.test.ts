import { env } from 'cloudflare:test'
import { createTorrentSnapshotsRepo } from '@server/adapters/repos/torrents'
import { createDb } from '@server/db/client'
import type { TorrentSnapshotRecord } from '@server/usecases/ports'
import { beforeEach, describe, expect, it } from 'vitest'

const USER_ID = 'torrent-snapshot-user'

beforeEach(async () => {
  await env.DB.prepare(
    'INSERT INTO users (id, name, oidc_email, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(USER_ID, 'Release Candidate Tester', 'torrents@zme.test', 'user', Date.now(), Date.now())
    .run()
})

describe('torrent snapshot repository in D1', () => {
  it('retains an owned query snapshot and expires it independently', async () => {
    const repo = createTorrentSnapshotsRepo(createDb(env))
    const id = crypto.randomUUID()
    await repo.saveQuery({
      id,
      userId: USER_ID,
      querySignature: '{"q":"The Martian"}',
      items: [snapshot(1).item, snapshot(2).item],
      expiresAt: '2026-08-18T01:00:00.000Z',
    })
    await expect(repo.getQuery(USER_ID, id, '2026-08-18T00:30:00.000Z')).resolves.toMatchObject({
      id,
      querySignature: '{"q":"The Martian"}',
      items: [{ id: 'release-1' }, { id: 'release-2' }],
    })
    await expect(repo.getQuery('another-user', id, '2026-08-18T00:30:00.000Z')).resolves.toBeNull()
    await expect(repo.getQuery(USER_ID, id, '2026-08-18T02:00:00.000Z')).resolves.toBeNull()
    await repo.deleteExpired('2026-08-18T02:00:00.000Z', 100)
    expect(
      await env.DB.prepare('SELECT COUNT(*) AS total FROM torrent_query_snapshots WHERE id = ?').bind(id).first(),
    ).toEqual({ total: 0 })
  })

  it('saves a full 50-item torrent page within the D1 parameter limit', async () => {
    const repo = createTorrentSnapshotsRepo(createDb(env))
    const records = Array.from({ length: 50 }, (_, index) => snapshot(index))

    await repo.saveMany(records)

    const saved = await env.DB.prepare('SELECT COUNT(*) AS total FROM release_candidate_snapshots WHERE user_id = ?')
      .bind(USER_ID)
      .first<{ total: number }>()
    expect(saved?.total).toBe(50)
    await expect(repo.get(USER_ID, records[49].id, '2026-08-18T00:30:00.000Z')).resolves.toMatchObject({
      id: records[49].id,
      mediaKey: 'tmdb:movie:286217',
    })
  })
})

function snapshot(index: number): TorrentSnapshotRecord {
  return {
    id: `torrent:${String(index).padStart(64, '0')}`,
    userId: USER_ID,
    mediaKey: 'tmdb:movie:286217',
    item: {
      id: `release-${index}`,
      downloadTarget: null,
      title: `The Martian 2015 release ${index}`,
      fileName: null,
      indexer: 'Test Indexer',
      size: 1_000 + index,
      seeders: index,
      leechers: 0,
      files: 1,
      protocol: 'torrent',
      publishDate: null,
      downloadUrl: `https://indexer.test/download/${index}`,
      magnetUrl: null,
      infoUrl: null,
      infoHash: null,
      categories: ['Movies'],
      categoryIds: [2000],
      indexerFlags: [],
      imdbId: null,
      tmdbId: 286217,
      tvdbId: null,
    },
    createdAt: '2026-08-18T00:00:00.000Z',
    expiresAt: '2026-08-18T01:00:00.000Z',
  }
}
