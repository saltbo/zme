import { encryptConnectorCredentials } from '@server/domain/connector-credentials'
import type { Env } from '@server/env'
import type { MediaSearchItem, MusicCollectionSummary } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enqueueConnectorSync, saveConnectorPlaylistSelection, syncConnector } from './connectors'
import type { Deps } from './deps'
import type { ConnectorRecord, ImportedLibraryEntry, LibraryRecord, MusicTrackRecord } from './ports'

const connectorRecord: ConnectorRecord = {
  id: 'connector-1',
  userId: 'user-1',
  kind: 'douban',
  externalAccountId: 'profile-1',
  displayName: 'profile-1',
  avatarUrl: null,
  settings: {},
  credentialsEncrypted: null,
  status: 'connected',
  enabled: true,
  lastSyncedAt: null,
  lastError: null,
  lastResult: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
}

afterEach(() => vi.restoreAllMocks())

function neteaseModule(input: { auth?: Record<string, unknown>; session?: Record<string, unknown> } = {}) {
  return {
    definition: {
      kind: 'netease',
      authModes: ['qr', 'sms'],
      capabilities: ['music.playlists.read', 'music.tracks.download'],
      dispatchIntervalSeconds: 10,
    },
    auth: input.auth ?? {},
    open: () => input.session ?? {},
  }
}

function musicTrackRecord(id: string, externalId: string): MusicTrackRecord {
  return {
    id,
    provider: 'netease',
    externalId,
    mediaKey: `netease:track:${externalId}`,
    title: externalId,
    artists: ['Artist'],
    release: null,
    coverUrl: null,
    durationMs: null,
    isrcs: [],
  }
}

function mediaItem(id: number, title: string): MediaSearchItem {
  return {
    id,
    kind: 'movie',
    title,
    originalTitle: title,
    overview: '',
    posterUrl: null,
    backdropUrl: null,
    releaseYear: '2020',
    rating: 8,
    genres: [],
  }
}

interface SyncFixture {
  deps: Deps
  inserted: LibraryRecord[]
  synced: Array<{ id: string; result: unknown; error: string | null }>
}

function createSyncDeps(
  entries: ImportedLibraryEntry[],
  searchResults: Record<string, MediaSearchItem[]>,
  fetchEntries?: () => Promise<ImportedLibraryEntry[]>,
): SyncFixture {
  const inserted: LibraryRecord[] = []
  const synced: SyncFixture['synced'] = []
  const deps = {
    connectorsRepo: {
      get: async () => connectorRecord,
      markSynced: async (id: string, result: unknown, error: string | null) => {
        synced.push({ id, result, error })
      },
    },
    libraryImporters: {
      douban: { fetchEntries: fetchEntries ?? (async () => entries) },
    },
    mediaSourcesRepo: {
      findEnabled: async () => ({
        id: 'media-source-1',
        description: null,
        kind: 'tmdb',
        credentials: { apiKey: 'test-key' },
        options: {},
        enabled: true,
        healthStatus: 'online',
        healthMessage: null,
        healthCheckedAt: null,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      }),
    },
    mediaProvider: {
      search: async (_source: unknown, query: string) => searchResults[query] ?? [],
    },
    libraryRepo: {
      get: async () => null,
      insert: async (record: LibraryRecord) => inserted.push(record),
    },
  }
  return { deps: deps as never as Deps, inserted, synced }
}

const env = {} as Env

describe('syncConnector', () => {
  it('imports Douban wish and collect entries through the connector abstraction', async () => {
    const entries: ImportedLibraryEntry[] = [
      { sourceId: 'd1', status: 'wish', title: 'Saved Movie', aliases: [], year: '2020', markedAt: null },
      {
        sourceId: 'd2',
        status: 'collect',
        title: 'Watched Movie',
        aliases: [],
        year: '2020',
        markedAt: '2026-05-01T00:00:00.000Z',
      },
      { sourceId: 'd3', status: 'wish', title: 'Unknown Movie', aliases: [], year: null, markedAt: null },
    ]
    const { deps, inserted, synced } = createSyncDeps(entries, {
      'Saved Movie': [mediaItem(11, 'Saved Movie')],
      'Watched Movie': [mediaItem(22, 'Watched Movie')],
    })

    const result = await syncConnector(deps, env, 'user-1', 'connector-1')

    expect(result).toEqual({
      capability: 'library.import',
      scanned: 3,
      imported: 2,
      saved: 1,
      watched: 1,
      unmatched: 1,
    })
    expect(synced).toEqual([{ id: 'connector-1', result, error: null }])
    expect(inserted.find((record) => record.tmdbId === 11)).toMatchObject({
      mediaKey: 'tmdb:movie:11',
      kind: 'movie',
      watchedAt: null,
    })
    expect(inserted.find((record) => record.tmdbId === 22)).toMatchObject({
      mediaKey: 'tmdb:movie:22',
      savedAt: '2026-05-01T00:00:00.000Z',
      watchedAt: '2026-05-01T00:00:00.000Z',
    })
  })

  it('rejects low-confidence matches', async () => {
    const entries: ImportedLibraryEntry[] = [
      { sourceId: 'd1', status: 'wish', title: 'Specific Title', aliases: [], year: '2020', markedAt: null },
    ]
    const { deps, inserted } = createSyncDeps(entries, {
      'Specific Title': [mediaItem(33, 'Entirely Different Film')],
    })

    const result = await syncConnector(deps, env, 'user-1', 'connector-1')

    expect(result).toMatchObject({ imported: 0, unmatched: 1 })
    expect(inserted).toEqual([])
  })

  it('records importer errors and rethrows them', async () => {
    const { deps, synced } = createSyncDeps([], {}, async () => {
      throw new Error('Douban profile is unreachable.')
    })

    await expect(syncConnector(deps, env, 'user-1', 'connector-1')).rejects.toThrow('Douban profile is unreachable.')
    expect(synced).toEqual([{ id: 'connector-1', result: null, error: 'Douban profile is unreachable.' }])
  })

  it('fails when the connector is not configured', async () => {
    const deps = { connectorsRepo: { get: async () => null } } as never as Deps
    await expect(syncConnector(deps, env, 'user-1', 'connector-1')).rejects.toThrow('Connector was not found.')
  })

  it('synchronizes tracks only for selected Netease playlists', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const secret = 'test-connector-secret-with-32-chars!'
    const remotePlaylists = ['remote-1', 'remote-2', 'remote-3'].map((externalId, index) => ({
      externalId,
      title: `Playlist ${index + 1}`,
      description: null,
      coverUrl: null,
      ownerName: 'Music Fan',
      trackCount: 1,
      remoteUpdatedAt: null,
    }))
    const existing = remotePlaylists.map((playlist, index) => ({
      id: `playlist-${index + 1}`,
      kind: 'playlist' as const,
      provider: 'netease' as const,
      ...playlist,
      libraryAddedAt: index < 2 ? '2026-07-20T00:00:00.000Z' : null,
      lastSyncedAt: null,
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
    }))
    const fetchedTrackPlaylists: string[] = []
    const replacedCollections: string[] = []
    const replacedTracks: unknown[][] = []
    const availabilityChecks: string[][] = []
    const availabilityUpdates: unknown[] = []
    const availabilityClears: string[] = []
    const getReleases = vi.fn(async () => [
      {
        externalId: 'album-1',
        title: 'Canonical Album',
        artists: ['Album Artist'],
        releaseDate: '2024-03-02',
        releaseType: 'album',
        providerReleaseType: 'Album',
        coverUrl: 'https://img.test/album.jpg',
      },
    ])
    const deps = {
      connectorsRepo: {
        get: async () => ({
          ...connectorRecord,
          kind: 'netease' as const,
          credentialsEncrypted: await encryptConnectorCredentials(secret, ['MUSIC_U=session-value']),
        }),
        markSynced: async () => undefined,
      },
      musicConnectors: new Map([
        [
          'netease',
          neteaseModule({
            session: {
              listPlaylists: async () => remotePlaylists,
              listTracks: async (playlistId: string) => {
                fetchedTrackPlaylists.push(playlistId)
                return [
                  {
                    provider: 'netease' as const,
                    externalId: `track-${playlistId}`,
                    mediaKey: `netease:track:${playlistId}`,
                    title: `Track ${playlistId}`,
                    artists: ['Artist'],
                    release: {
                      provider: 'netease',
                      externalId: 'album-1',
                      title: 'Compact Album Name',
                      artists: [],
                      releaseDate: null,
                      releaseType: 'unknown',
                      providerReleaseType: null,
                      coverUrl: null,
                      metadataUpdatedAt: null,
                      discNumber: 1,
                      trackNumber: 2,
                    },
                    coverUrl: null,
                    durationMs: null,
                    isrcs: [],
                  },
                ]
              },
              getReleases,
              checkTrackAvailability: async (trackIds: string[]) => {
                availabilityChecks.push(trackIds)
                return {
                  results: new Map([
                    [
                      trackIds[0] ?? '',
                      { status: 'available' as const, reason: null, providerCode: '200', providerDetails: {} },
                    ],
                  ]),
                  interrupted: {
                    reason: 'rate_limited' as const,
                    providerCode: '429',
                    message: 'Netease request failed: 429',
                  },
                }
              },
            },
          }),
        ],
      ]),
      musicCollectionsRepo: {
        listForConnector: async () => existing,
        upsert: async (userId: string, input: Parameters<Deps['musicCollectionsRepo']['upsert']>[1]) => ({
          id: existing.find((item) => item.externalId === input.externalId)?.id ?? 'unexpected-playlist',
          userId,
          ...input,
        }),
        replaceTracks: async (collectionId: string, playlistTracks: unknown[]) => {
          replacedCollections.push(collectionId)
          replacedTracks.push(playlistTracks)
        },
        listReleaseMetadata: async () => [],
        updateSnapshot: async () => existing[0],
        deleteMissingConnectorCollections: async () => undefined,
        clearTrackAvailabilities: async (connectorId: string) => {
          availabilityClears.push(connectorId)
        },
        listTracksForAvailabilityCheck: async () => [
          musicTrackRecord('track-1', 'track-remote-1'),
          musicTrackRecord('track-2', 'track-remote-2'),
        ],
        setTrackAvailabilities: async (_userId: string, _connectorId: string, updates: unknown[]) => {
          availabilityUpdates.push(...updates)
        },
      },
      mediaSubscriptionsRepo: { find: async () => null },
    } as never as Deps

    const result = await syncConnector(
      deps,
      { CONNECTOR_CREDENTIALS_SECRET: secret } as Env,
      'user-1',
      'connector-1',
      'manual',
    )

    expect(fetchedTrackPlaylists).toEqual(['remote-1', 'remote-2'])
    expect(replacedCollections).toEqual(['playlist-1', 'playlist-2'])
    expect(getReleases).toHaveBeenCalledOnce()
    expect(getReleases).toHaveBeenCalledWith(['album-1'])
    expect(replacedTracks[0]?.[0]).toMatchObject({
      release: {
        title: 'Canonical Album',
        artists: ['Album Artist'],
        releaseDate: '2024-03-02',
        releaseType: 'album',
        providerReleaseType: 'Album',
        discNumber: 1,
        trackNumber: 2,
        metadataUpdatedAt: expect.any(String),
      },
      coverUrl: 'https://img.test/album.jpg',
    })
    expect(availabilityClears).toEqual(['connector-1'])
    expect(availabilityChecks).toEqual([['track-remote-1', 'track-remote-2']])
    expect(availabilityUpdates).toEqual([
      {
        trackId: 'track-1',
        status: 'available',
        reason: null,
        providerCode: '200',
        providerDetails: {},
        checkedAt: expect.any(String),
      },
      {
        trackId: 'track-2',
        status: 'unknown',
        reason: 'rate_limited',
        providerCode: '429',
        providerDetails: {},
        checkedAt: expect.any(String),
      },
    ])
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('connector.music_availability.interrupted'))
    expect(result).toEqual({
      capability: 'music.playlists.read',
      playlists: 3,
      selectedPlaylists: 2,
      tracks: 2,
    })
  })
})

describe('saveConnectorPlaylistSelection', () => {
  it('saves the complete selection once and queues one background sync', async () => {
    const playlist: MusicCollectionSummary = {
      id: 'playlist-1',
      kind: 'playlist',
      provider: 'netease',
      externalId: 'remote-playlist-1',
      title: 'Daily Mix',
      description: null,
      coverUrl: null,
      ownerName: 'Music Fan',
      trackCount: 35,
      libraryAddedAt: null,
      remoteUpdatedAt: null,
      lastSyncedAt: null,
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
    }
    const savedSelections: string[][] = []
    const enqueue = vi.fn(async () => undefined)
    const deps = {
      connectorsRepo: {
        get: async () => ({ ...connectorRecord, kind: 'netease' as const }),
      },
      musicCollectionsRepo: {
        listForConnector: async () => [playlist],
        setLibrarySelections: async (_userId: string, _connectorId: string, selectedPlaylistIds: string[]) =>
          savedSelections.push(selectedPlaylistIds),
        replaceTracks: async () => {
          throw new Error('Playlist selection must not synchronize tracks.')
        },
      },
      musicConnectors: new Map([['netease', neteaseModule()]]),
      connectorSyncQueue: { enqueue },
    } as never as Deps

    await expect(
      saveConnectorPlaylistSelection(deps, 'user-1', 'connector-1', ['playlist-1', 'playlist-1']),
    ).resolves.toEqual({ selectedPlaylists: 1 })
    expect(savedSelections).toEqual([['playlist-1']])
    expect(enqueue).toHaveBeenCalledOnce()
    expect(enqueue).toHaveBeenCalledWith({ userId: 'user-1', connectorId: 'connector-1' })
  })

  it('rejects playlists outside the connector without saving or queuing', async () => {
    const setLibrarySelections = vi.fn()
    const enqueue = vi.fn()
    const deps = {
      connectorsRepo: { get: async () => ({ ...connectorRecord, kind: 'netease' as const }) },
      musicCollectionsRepo: { listForConnector: async () => [], setLibrarySelections },
      musicConnectors: new Map([['netease', neteaseModule()]]),
      connectorSyncQueue: { enqueue },
    } as never as Deps

    await expect(saveConnectorPlaylistSelection(deps, 'user-1', 'connector-1', ['unknown-playlist'])).rejects.toThrow(
      'Connector playlist was not found.',
    )
    expect(setLibrarySelections).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })
})

describe('enqueueConnectorSync', () => {
  it('queues an existing connector without running the sync inline', async () => {
    const enqueue = vi.fn(async () => undefined)
    const deps = {
      connectorsRepo: { get: async () => connectorRecord },
      connectorSyncQueue: { enqueue },
    } as never as Deps

    await enqueueConnectorSync(deps, 'user-1', 'connector-1')

    expect(enqueue).toHaveBeenCalledWith({ userId: 'user-1', connectorId: 'connector-1' })
  })
})
