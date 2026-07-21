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

  it('replaces the complete library selection in one batch operation', async () => {
    const repo = createMusicCollectionsRepo(createDb(env))
    const collections = []
    for (let index = 0; index < 105; index += 1) {
      collections.push(await repo.upsert(USER_ID, playlistInput(`selection-${index}`, '2026-07-20T00:00:00.000Z')))
    }
    const selectedIds = collections.filter((_item, index) => index % 2 === 0).map((item) => item.id)

    await repo.setLibrarySelections(USER_ID, CONNECTOR_ID, selectedIds, '2026-07-21T02:00:00.000Z')

    const saved = await repo.listForConnector(USER_ID, CONNECTOR_ID)
    expect(
      saved
        .filter((item) => item.libraryAddedAt)
        .map((item) => item.id)
        .sort(),
    ).toEqual([...selectedIds].sort())
  })

  it('replaces a playlist containing more than 25 tracks', async () => {
    const repo = createMusicCollectionsRepo(createDb(env))
    const collection = await repo.upsert(USER_ID, playlistInput('large-playlist'))
    const tracks = Array.from({ length: 30 }, (_, index) => trackInput(index))

    await repo.replaceTracks(collection.id, tracks)

    const details = await repo.getDetails(USER_ID, collection.id)
    expect(details?.tracks).toHaveLength(30)
    expect(details?.tracks.map((track) => track.position)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1))
    expect(details?.tracks[0]).toMatchObject({ downloadStatus: 'unknown', downloadCheckedAt: null })

    await repo.setTrackAvailabilities(
      USER_ID,
      CONNECTOR_ID,
      (details?.tracks ?? []).map((track, index) => {
        const providerDetails: Record<string, string | number | boolean | null> =
          index % 2 === 0 ? {} : { fee: 1, payed: 0 }
        return {
          trackId: track.id,
          status: index % 2 === 0 ? ('available' as const) : ('unavailable' as const),
          reason: index % 2 === 0 ? null : ('membership_required' as const),
          providerCode: index % 2 === 0 ? '200' : '404',
          providerDetails,
          checkedAt: '2026-07-21T01:00:00.000Z',
        }
      }),
    )
    const updated = await repo.getDetails(USER_ID, collection.id)
    expect(updated?.tracks[0]).toMatchObject({
      downloadStatus: 'available',
      downloadCheckedAt: '2026-07-21T01:00:00.000Z',
    })
    expect(updated?.tracks[1]).toMatchObject({
      downloadStatus: 'unavailable',
      downloadReason: 'membership_required',
      downloadProviderCode: '404',
    })
  })

  it('shares fresh availability across playlists and returns each track once for checking', async () => {
    const repo = createMusicCollectionsRepo(createDb(env))
    const first = await repo.upsert(USER_ID, playlistInput('playlist-a', '2026-07-20T00:00:00.000Z'))
    const second = await repo.upsert(USER_ID, playlistInput('playlist-b', '2026-07-20T00:00:00.000Z'))
    await repo.replaceTracks(first.id, [trackInput(1)])
    await repo.replaceTracks(second.id, [trackInput(1)])

    const uncached = await repo.listTracksForAvailabilityCheck(USER_ID, CONNECTOR_ID, '2026-07-21T00:00:00.000Z', 500)
    expect(uncached).toHaveLength(1)

    await repo.setTrackAvailabilities(USER_ID, CONNECTOR_ID, [
      {
        trackId: uncached[0]?.id ?? '',
        status: 'available',
        reason: null,
        providerCode: '200',
        providerDetails: {},
        checkedAt: '2026-07-21T01:00:00.000Z',
      },
    ])
    const fresh = await repo.listTracksForAvailabilityCheck(USER_ID, CONNECTOR_ID, '2026-07-21T00:00:00.000Z', 500)
    expect(fresh).toEqual([])
    expect((await repo.getDetails(USER_ID, second.id))?.tracks[0]).toMatchObject({ downloadStatus: 'available' })

    await repo.clearTrackAvailabilities(CONNECTOR_ID)
    expect((await repo.getDetails(USER_ID, first.id))?.tracks[0]).toMatchObject({ downloadStatus: 'unknown' })

    await repo.setTrackAvailabilities(USER_ID, CONNECTOR_ID, [
      {
        trackId: uncached[0]?.id ?? '',
        status: 'unknown',
        reason: 'provider_error',
        providerCode: '503',
        providerDetails: {},
        checkedAt: '2026-07-21T01:00:00.000Z',
      },
    ])
    expect(await repo.listTracksForAvailabilityCheck(USER_ID, CONNECTOR_ID, '2026-07-21T00:00:00.000Z', 500)).toEqual(
      [],
    )
    expect(
      await repo.listTracksForAvailabilityCheck(USER_ID, CONNECTOR_ID, '2026-07-21T02:00:00.000Z', 500),
    ).toHaveLength(1)
  })
})

function playlistInput(externalId: string, libraryAddedAt: string | null = null) {
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
    libraryAddedAt,
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
