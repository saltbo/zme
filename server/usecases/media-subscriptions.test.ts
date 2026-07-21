import type { MusicCollectionDetails, MusicCollectionSummary } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import {
  disableMusicCollectionSubscription,
  enableMusicCollectionSubscription,
  evaluateMusicCollectionSubscription,
} from './media-subscriptions'
import type { DownloadRecordRecord, MediaSubscriptionRecord } from './ports'

const collection: MusicCollectionSummary & { userId: string; connectorId: string } = {
  id: 'playlist-1',
  userId: 'user-1',
  connectorId: 'connector-1',
  kind: 'playlist',
  provider: 'netease',
  externalId: 'remote-1',
  title: 'Road Trip',
  description: null,
  coverUrl: null,
  ownerName: 'Music Fan',
  trackCount: 2,
  libraryAddedAt: '2026-07-20T00:00:00.000Z',
  remoteUpdatedAt: null,
  lastSyncedAt: null,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
}

const tracks: MusicCollectionDetails['tracks'] = [
  {
    id: 'track-1',
    provider: 'netease',
    externalId: 'remote-track-1',
    mediaKey: 'netease:track:remote-track-1',
    title: 'Available Track',
    artists: ['Artist'],
    albumTitle: null,
    albumExternalId: null,
    albumArtists: [],
    albumReleaseDate: null,
    albumReleaseType: null,
    discNumber: null,
    trackNumber: null,
    coverUrl: null,
    durationMs: null,
    isrcs: [],
    position: 1,
    addedAt: null,
    downloadStatus: 'available',
    downloadReason: null,
    downloadProviderCode: '200',
    downloadCheckedAt: null,
    downloadRecord: null,
  },
  {
    id: 'track-2',
    provider: 'netease',
    externalId: 'remote-track-2',
    mediaKey: 'netease:track:remote-track-2',
    title: 'Unavailable Track',
    artists: ['Artist'],
    albumTitle: null,
    albumExternalId: null,
    albumArtists: [],
    albumReleaseDate: null,
    albumReleaseType: null,
    discNumber: null,
    trackNumber: null,
    coverUrl: null,
    durationMs: null,
    isrcs: [],
    position: 2,
    addedAt: null,
    downloadStatus: 'unavailable',
    downloadReason: 'membership_required',
    downloadProviderCode: '404',
    downloadCheckedAt: null,
    downloadRecord: null,
  },
]

function createFixture() {
  let currentTracks = [...tracks]
  let subscription: MediaSubscriptionRecord | null = null
  const records: DownloadRecordRecord[] = []
  const links = new Set<string>()
  const wake = vi.fn(async () => undefined)
  const markEvaluated = vi.fn(async (id: string, at: string) => {
    if (subscription?.id === id) subscription = { ...subscription, lastEvaluatedAt: at, updatedAt: at }
  })
  const deps = {
    musicCollectionsRepo: {
      get: async () => collection,
      getDetails: async () => ({ ...collection, subscription: null, tracks: currentTracks }),
    },
    downloadersRepo: {
      getEnabled: async () => ({
        id: 'downloader-1',
        kind: 'zpan',
        config: { endpoint: 'https://zpan.test', credentials: {}, options: {} },
        enabled: true,
      }),
    },
    downloaderGateways: { zpan: { supportedSourceTypes: ['magnet', 'torrent_url', 'http'] } },
    mediaSubscriptionsRepo: {
      find: async () => subscription,
      upsertMusicCollection: async (
        _userId: string,
        _collectionId: string,
        input: { downloaderId: string; now: string },
      ) => {
        subscription = {
          id: 'subscription-1',
          userId: 'user-1',
          subjectType: 'music_collection',
          subjectKey: collection.id,
          downloaderId: input.downloaderId,
          enabled: true,
          lastEvaluatedAt: null,
          createdAt: input.now,
          updatedAt: input.now,
        }
        return subscription
      },
      markEvaluated,
      disable: async (_userId: string, _id: string, now: string) => {
        if (!subscription) return null
        subscription = { ...subscription, enabled: false, updatedAt: now }
        return subscription
      },
    },
    downloadRecordsRepo: {
      listByResourceKeys: async (_userId: string, _kind: string, keys: string[]) =>
        records.filter((record) => keys.includes(record.resourceKey)),
      createMany: async (created: DownloadRecordRecord[]) => {
        for (const record of created) {
          if (!records.some((item) => item.resourceKey === record.resourceKey)) records.push(record)
        }
      },
      update: async (id: string, generation: number, patch: Partial<DownloadRecordRecord>) => {
        const index = records.findIndex((record) => record.id === id && record.generation === generation)
        if (index < 0) return null
        records[index] = { ...records[index], ...patch }
        return records[index]
      },
      linkSubscriptionMany: async (_subscriptionId: string, ids: string[]) => {
        for (const id of ids) links.add(id)
      },
      cancelUnwantedForSubscription: async () => {
        let canceled = 0
        for (const record of records) {
          if (record.status !== 'queued' && record.status !== 'waiting_source') continue
          record.status = 'canceled'
          canceled += 1
        }
        return canceled
      },
    },
    downloadDispatchQueue: { wake },
  } as never as Deps

  return {
    deps,
    records,
    links,
    wake,
    markEvaluated,
    setTracks(next: MusicCollectionDetails['tracks']) {
      currentTracks = next
    },
  }
}

describe('music collection subscriptions', () => {
  it('persists the whole current playlist in batches and wakes its lane once', async () => {
    const fixture = createFixture()

    const result = await enableMusicCollectionSubscription(fixture.deps, 'user-1', collection.id, {
      downloaderId: 'downloader-1',
    })

    expect(result).toMatchObject({ queued: 1, waiting: 1, skipped: 0, canceled: 0 })
    expect(fixture.records).toHaveLength(2)
    expect(fixture.records.map((record) => record.status)).toEqual(['queued', 'waiting_source'])
    expect(fixture.records.map((record) => record.config.preferredQuality)).toEqual(['hires', 'hires'])
    expect(fixture.links.size).toBe(2)
    expect(fixture.wake).toHaveBeenCalledOnce()
    expect(fixture.wake).toHaveBeenCalledWith('netease:connector-1')
    expect(fixture.markEvaluated).toHaveBeenCalledOnce()
  })

  it('adds only newly synchronized tracks and never requeues accepted history', async () => {
    const fixture = createFixture()
    await enableMusicCollectionSubscription(fixture.deps, 'user-1', collection.id, {
      downloaderId: 'downloader-1',
    })
    fixture.records[0].status = 'accepted'
    fixture.records[0].firstAcceptedAt = '2026-07-20T01:00:00.000Z'
    fixture.records[0].lastAcceptedAt = '2026-07-20T01:00:00.000Z'
    fixture.wake.mockClear()
    fixture.setTracks([
      ...tracks,
      {
        ...tracks[0],
        id: 'track-3',
        externalId: 'remote-track-3',
        mediaKey: 'netease:track:remote-track-3',
        title: 'New Track',
        position: 3,
      },
    ])

    await evaluateMusicCollectionSubscription(fixture.deps, 'user-1', collection.id)

    expect(fixture.records).toHaveLength(3)
    expect(fixture.records[0]).toMatchObject({ status: 'accepted', generation: 1 })
    expect(fixture.records[2]).toMatchObject({ resourceKey: 'netease:track:remote-track-3', status: 'queued' })
    expect(fixture.wake).toHaveBeenCalledOnce()
  })

  it('requeues a waiting subscription track after availability recovers', async () => {
    const fixture = createFixture()
    await enableMusicCollectionSubscription(fixture.deps, 'user-1', collection.id, {
      downloaderId: 'downloader-1',
    })
    fixture.wake.mockClear()
    fixture.setTracks([
      tracks[0],
      {
        ...tracks[1],
        downloadStatus: 'available',
        downloadReason: null,
        downloadProviderCode: '200',
      },
    ])

    await evaluateMusicCollectionSubscription(fixture.deps, 'user-1', collection.id)

    expect(fixture.records.map((record) => record.status)).toEqual(['queued', 'queued'])
    expect(fixture.wake).toHaveBeenCalledOnce()
  })

  it('cancels only pending subscription work when disabled', async () => {
    const fixture = createFixture()
    await enableMusicCollectionSubscription(fixture.deps, 'user-1', collection.id, {
      downloaderId: 'downloader-1',
    })

    const result = await disableMusicCollectionSubscription(fixture.deps, 'user-1', collection.id)

    expect(result).toMatchObject({ queued: 0, waiting: 0, skipped: 0, canceled: 2 })
    expect(fixture.records.every((record) => record.status === 'canceled')).toBe(true)
  })
})
