import { decryptConnectorCredentials, encryptConnectorCredentials } from '@server/domain/connector-credentials'
import type { Env } from '@server/env'
import type { MediaSearchItem, MusicCollectionSummary } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkNeteaseLogin,
  enqueueConnectorSync,
  loginNeteaseWithSms,
  saveConnectorPlaylistSelection,
  sendNeteaseSmsCode,
  syncConnector,
} from './connectors'
import type { Deps } from './deps'
import type {
  ConnectorLoginAttemptRecord,
  ConnectorRecord,
  ImportedLibraryEntry,
  LibraryRecord,
  MusicTrackRecord,
} from './ports'

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

function musicTrackRecord(id: string, externalId: string): MusicTrackRecord {
  return {
    id,
    provider: 'netease',
    externalId,
    mediaKey: `netease:track:${externalId}`,
    title: externalId,
    artists: ['Artist'],
    albumTitle: null,
    albumExternalId: null,
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
    const availabilityChecks: string[][] = []
    const availabilityUpdates: unknown[] = []
    const availabilityClears: string[] = []
    const deps = {
      connectorsRepo: {
        get: async () => ({
          ...connectorRecord,
          kind: 'netease' as const,
          credentialsEncrypted: await encryptConnectorCredentials(secret, ['MUSIC_U=session-value']),
        }),
        markSynced: async () => undefined,
      },
      musicPlaylistConnectors: {
        netease: {
          listPlaylists: async () => remotePlaylists,
          listTracks: async (_credentials: string[], playlistId: string) => {
            fetchedTrackPlaylists.push(playlistId)
            return [
              {
                provider: 'netease' as const,
                externalId: `track-${playlistId}`,
                mediaKey: `netease:track:${playlistId}`,
                title: `Track ${playlistId}`,
                artists: ['Artist'],
                albumTitle: null,
                albumExternalId: null,
                coverUrl: null,
                durationMs: null,
                isrcs: [],
              },
            ]
          },
          checkTrackAvailability: async (_credentials: string[], trackIds: string[]) => {
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
      },
      musicCollectionsRepo: {
        listForConnector: async () => existing,
        upsert: async (userId: string, input: Parameters<Deps['musicCollectionsRepo']['upsert']>[1]) => ({
          id: existing.find((item) => item.externalId === input.externalId)?.id ?? 'unexpected-playlist',
          userId,
          ...input,
        }),
        replaceTracks: async (collectionId: string) => {
          replacedCollections.push(collectionId)
        },
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
      musicPlaylistConnectors: {
        netease: {
          listTracks: async () => {
            throw new Error('Playlist selection must not call Netease.')
          },
        },
      },
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

describe('Netease SMS login', () => {
  it('delegates SMS code delivery without persisting the recipient', async () => {
    let received: { countryCode: string; phone: string } | null = null
    const deps = {
      musicPlaylistConnectors: {
        netease: {
          sendSmsCode: async (input: { countryCode: string; phone: string }) => {
            received = input
          },
        },
      },
    } as never as Deps

    await sendNeteaseSmsCode(deps, { countryCode: '86', phone: '13800138000' })

    expect(received).toEqual({ countryCode: '86', phone: '13800138000' })
  })

  it('encrypts the returned session and saves the connected account', async () => {
    const secret = 'test-connector-secret-with-32-chars!'
    type SaveInput = Parameters<Deps['connectorsRepo']['save']>[2]
    const saved: { input: SaveInput | null } = { input: null }
    let record: ConnectorRecord | null = null
    const deps = {
      connectorsRepo: {
        findByKind: async () => null,
        save: async (userId: string, kind: ConnectorRecord['kind'], input: SaveInput) => {
          saved.input = input
          record = {
            id: 'netease-connector-1',
            userId,
            kind,
            ...input,
            lastSyncedAt: null,
            lastError: null,
            lastResult: null,
            createdAt: '2026-07-20T00:00:00.000Z',
            updatedAt: '2026-07-20T00:00:00.000Z',
          }
          return record
        },
        get: async () => record,
        markSynced: async () => undefined,
      },
      musicPlaylistConnectors: {
        netease: {
          loginWithSms: async () => ({
            status: 'connected',
            cookies: ['MUSIC_U=session-value', '__csrf=csrf-value'],
            account: {
              externalAccountId: '42',
              displayName: 'Music Fan',
              avatarUrl: 'https://img.test/42.jpg',
            },
          }),
          listPlaylists: async () => [],
        },
      },
      musicCollectionsRepo: {
        listForConnector: async () => [],
        deleteMissingConnectorCollections: async () => undefined,
        clearTrackAvailabilities: async () => undefined,
        listTracksForAvailabilityCheck: async () => [],
      },
    } as never as Deps

    const result = await loginNeteaseWithSms(deps, { CONNECTOR_CREDENTIALS_SECRET: secret } as Env, 'user-1', {
      countryCode: '86',
      phone: '13800138000',
      code: '1234',
    })

    expect(result.connector).toMatchObject({
      kind: 'netease',
      displayName: 'Music Fan',
      authModes: ['qr', 'sms'],
      status: 'connected',
    })
    expect(result.verification).toBeNull()
    expect(saved.input).toMatchObject({
      externalAccountId: '42',
      settings: {},
      status: 'connected',
      enabled: true,
    })
    if (!saved.input) throw new Error('The connector was not saved.')
    const encryptedCredentials = saved.input.credentialsEncrypted
    expect(encryptedCredentials).not.toBeNull()
    expect(await decryptConnectorCredentials(secret, encryptedCredentials as string)).toEqual([
      'MUSIC_U=session-value',
      '__csrf=csrf-value',
    ])
  })

  it('stores only an encrypted temporary device session when account verification is required', async () => {
    const secret = 'test-connector-secret-with-32-chars!'
    const created: { attempt: ConnectorLoginAttemptRecord | null } = { attempt: null }
    const deps = {
      connectorLoginAttemptsRepo: {
        create: async (attempt: ConnectorLoginAttemptRecord) => {
          created.attempt = attempt
        },
      },
      musicPlaylistConnectors: {
        netease: {
          loginWithSms: async () => ({
            status: 'verification_required',
            cookies: ['deviceId=device-1', 'NMTID=nmtid-1'],
            verification: {
              qrCode: 'risk-qr-code',
              qrUrl: 'https://st.music.163.com/encrypt-pages?qrCode=risk-qr-code',
              expiresAt: '2026-07-20T01:05:00.000Z',
            },
          }),
        },
      },
    } as never as Deps

    const result = await loginNeteaseWithSms(deps, { CONNECTOR_CREDENTIALS_SECRET: secret } as Env, 'user-1', {
      countryCode: '86',
      phone: '13800138000',
      code: '1234',
    })

    expect(result.connector).toBeNull()
    expect(result.verification).toMatchObject({
      kind: 'netease',
      qrUrl: 'https://st.music.163.com/encrypt-pages?qrCode=risk-qr-code',
      status: 'waiting_scan',
    })
    if (!created.attempt?.credentialsEncrypted) throw new Error('The verification attempt was not stored.')
    expect(created.attempt.externalKey).not.toContain('13800138000')
    expect(created.attempt.externalKey).not.toContain('1234')
    expect(await decryptConnectorCredentials(secret, created.attempt.credentialsEncrypted)).toEqual([
      'deviceId=device-1',
      'NMTID=nmtid-1',
    ])
  })
})

describe('Netease QR login', () => {
  it('stores a QR account verification challenge with the original login key', async () => {
    const secret = 'test-connector-secret-with-32-chars!'
    let attempt: ConnectorLoginAttemptRecord = {
      id: 'attempt-1',
      userId: 'user-1',
      kind: 'netease',
      externalKey: 'login-key-1',
      credentialsEncrypted: await encryptConnectorCredentials(secret, ['MUSIC_A=anonymous-session']),
      status: 'waiting_scan',
      expiresAt: '2099-07-20T01:00:00.000Z',
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
    }
    const deps = {
      connectorLoginAttemptsRepo: {
        get: async () => attempt,
        update: async (_userId: string, _id: string, patch: Partial<ConnectorLoginAttemptRecord>) => {
          attempt = { ...attempt, ...patch }
          return attempt
        },
      },
      musicPlaylistConnectors: {
        netease: {
          checkQrLogin: async () => ({
            status: 'verification_required',
            cookies: ['MUSIC_A=anonymous-session', 'deviceId=device-1'],
            verification: {
              qrCode: 'risk-qr-code',
              qrUrl: 'https://st.music.163.com/encrypt-pages?qrCode=risk-qr-code',
              expiresAt: '2099-07-20T01:05:00.000Z',
            },
          }),
        },
      },
    } as never as Deps

    const result = await checkNeteaseLogin(deps, { CONNECTOR_CREDENTIALS_SECRET: secret } as Env, 'user-1', 'attempt-1')

    expect(result.connector).toBeNull()
    expect(result.attempt).toMatchObject({
      qrUrl: 'https://st.music.163.com/encrypt-pages?qrCode=risk-qr-code',
      status: 'waiting_scan',
    })
    expect(attempt.externalKey).toContain('"loginKey":"login-key-1"')
  })
})
