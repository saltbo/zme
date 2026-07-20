import { env } from 'cloudflare:test'
import { createMusicCollectionsRepo } from '@server/adapters/repos/music-collections'
import { createDb } from '@server/db/client'
import type { MusicTrackInput } from '@server/usecases/ports'
import { beforeEach, describe, expect, it } from 'vitest'

const USER_ID = 'music-test-user'
const CONNECTOR_ID = 'music-test-connector'

beforeEach(async () => {
  const now = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO user (id, name, email, email_verified, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(USER_ID, 'Music Tester', 'music-repo@zme.test', 1, 'admin', Date.now(), Date.now()),
    env.DB.prepare(
      'INSERT INTO connectors (id, user_id, kind, external_account_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(CONNECTOR_ID, USER_ID, 'netease', 'netease-user', 'Netease User', now, now),
  ])
})

describe('music collections repository in D1', () => {
  it('removes stale collections when the remote account has more than 100 playlists', async () => {
    const repo = createMusicCollectionsRepo(createDb(env))
    for (let index = 0; index < 105; index += 1) {
      await repo.upsert(USER_ID, playlistInput(`playlist-${index}`))
    }

    const remoteIds = Array.from({ length: 104 }, (_, index) => `playlist-${index}`)
    await repo.deleteMissingConnectorCollections(CONNECTOR_ID, remoteIds)

    const remaining = await repo.listForConnector(USER_ID, CONNECTOR_ID)
    expect(remaining).toHaveLength(104)
    expect(remaining.some((item) => item.externalId === 'playlist-104')).toBe(false)
  })

  it('replaces a playlist containing more than 25 tracks', async () => {
    const repo = createMusicCollectionsRepo(createDb(env))
    const collection = await repo.upsert(USER_ID, playlistInput('large-playlist'))
    const tracks = Array.from({ length: 30 }, (_, index) => trackInput(index))

    await repo.replaceTracks(collection.id, tracks)

    const details = await repo.getDetails(USER_ID, collection.id)
    expect(details?.tracks).toHaveLength(30)
    expect(details?.tracks.map((track) => track.position)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1))
  })
})

function playlistInput(externalId: string) {
  return {
    connectorId: CONNECTOR_ID,
    kind: 'playlist' as const,
    provider: 'netease' as const,
    externalId,
    title: externalId,
    description: null,
    coverUrl: null,
    ownerName: 'Music Tester',
    trackCount: 0,
    libraryAddedAt: null,
    remoteUpdatedAt: null,
    lastSyncedAt: null,
  }
}

function trackInput(index: number): MusicTrackInput {
  const externalId = `track-${index}`
  return {
    provider: 'netease',
    externalId,
    mediaKey: `netease:track:${externalId}`,
    title: externalId,
    artists: ['Artist'],
    albumTitle: null,
    albumExternalId: null,
    coverUrl: null,
    durationMs: 180_000,
    isrcs: [],
    addedAt: null,
  }
}
