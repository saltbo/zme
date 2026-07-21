import type { MusicCollectionDetails, MusicFavoriteTrackInput } from '@shared/types'
import { describe, expect, it } from 'vitest'
import type { Deps } from './deps'
import { setFavoriteSong } from './music-library'
import type { MusicCollectionRecord, MusicTrackInput } from './ports'

const track: MusicFavoriteTrackInput = {
  provider: 'musicbrainz',
  externalId: 'recording-1',
  mediaKey: 'musicbrainz:recording:recording-1',
  title: 'Favorite Track',
  artists: ['Artist'],
  albumTitle: 'Album',
  albumExternalId: 'album-1',
  coverUrl: null,
  durationMs: 180_000,
  isrcs: [],
}

function createDeps() {
  let collection: MusicCollectionRecord | null = null
  let tracks: MusicTrackInput[] = []
  const deps = {
    musicCollectionsRepo: {
      find: async () => collection,
      upsert: async () => {
        collection = {
          id: 'favorites-1',
          userId: 'user-1',
          connectorId: null,
          kind: 'favorites',
          provider: 'zme',
          externalId: 'favorite-songs',
          title: 'Favorite Songs',
          description: null,
          coverUrl: null,
          ownerName: null,
          trackCount: 0,
          libraryAddedAt: '2026-07-20T00:00:00.000Z',
          remoteUpdatedAt: null,
          lastSyncedAt: null,
          createdAt: '2026-07-20T00:00:00.000Z',
          updatedAt: '2026-07-20T00:00:00.000Z',
        }
        return collection
      },
      getDetails: async (): Promise<MusicCollectionDetails | null> =>
        collection
          ? {
              ...collection,
              tracks: tracks.map((item, index) => ({
                ...item,
                id: `track-${index + 1}`,
                position: index + 1,
                addedAt: item.addedAt ?? null,
                downloadStatus: 'unknown',
                downloadCheckedAt: null,
              })),
            }
          : null,
      replaceTracks: async (_collectionId: string, nextTracks: MusicTrackInput[]) => {
        tracks = nextTracks
      },
      updateSnapshot: async (_userId: string, _id: string, input: { trackCount: number; lastSyncedAt: string }) => {
        if (collection) collection = { ...collection, ...input }
        return collection
      },
    },
    mediaSubscriptionsRepo: { find: async () => null },
    downloadRecordsRepo: { listByResourceKeys: async () => [] },
  }
  return { deps: deps as never as Deps, getTracks: () => tracks }
}

describe('Favorite Songs', () => {
  it('creates the system playlist lazily and avoids duplicate tracks', async () => {
    const fixture = createDeps()

    const first = await setFavoriteSong(fixture.deps, 'user-1', track, true)
    const second = await setFavoriteSong(fixture.deps, 'user-1', track, true)

    expect(first).toMatchObject({ kind: 'favorites', provider: 'zme', trackCount: 1 })
    expect(second?.tracks).toHaveLength(1)
    expect(fixture.getTracks()).toHaveLength(1)
  })

  it('keeps the system playlist and removes an unfavorited track', async () => {
    const fixture = createDeps()
    await setFavoriteSong(fixture.deps, 'user-1', track, true)

    const result = await setFavoriteSong(fixture.deps, 'user-1', track, false)

    expect(result).toMatchObject({ kind: 'favorites', trackCount: 0 })
    expect(result?.tracks).toEqual([])
  })
})
