import { encryptConnectorPayload } from '@server/domain/connector-credentials'
import type { Env } from '@server/env'
import { describe, expect, it, vi } from 'vitest'
import { syncConnector } from './connectors'
import type { Deps } from './deps'
import type { ConnectorRecord, MusicConnectorModule, MusicTrackInput } from './ports'

describe('music connector contract', () => {
  it('synchronizes a second provider through the registry without provider-specific branches', async () => {
    const secret = 'fake-provider-secret-at-least-32-characters'
    const connector: ConnectorRecord = {
      id: 'connector-fake',
      userId: 'user-1',
      kind: 'fake-music',
      externalAccountId: 'account-1',
      displayName: 'Fake Music',
      avatarUrl: null,
      settings: {},
      credentialsEncrypted: await encryptConnectorPayload(secret, { token: 'credential-1' }),
      status: 'connected',
      enabled: true,
      lastSyncedAt: null,
      lastError: null,
      lastResult: null,
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z',
    }
    const replaceTracks = vi.fn(async (_collectionId: string, _tracks: MusicTrackInput[]) => undefined)
    const module = {
      definition: {
        kind: 'fake-music',
        authModes: ['qr'],
        capabilities: ['music.playlists.read', 'music.tracks.download'],
        dispatchIntervalSeconds: 30,
      },
      auth: {},
      open: (credentials: unknown) => {
        expect(credentials).toEqual({ token: 'credential-1' })
        return {
          listPlaylists: async () => [
            {
              externalId: 'playlist-1',
              title: 'Playlist',
              description: null,
              coverUrl: null,
              ownerName: null,
              trackCount: 1,
              remoteUpdatedAt: null,
            },
          ],
          listTracks: async () => [
            {
              provider: 'fake-music',
              externalId: 'track-1',
              mediaKey: 'fake-music:track:track-1',
              title: 'Track',
              artists: ['Artist'],
              release: null,
              coverUrl: null,
              durationMs: null,
              isrcs: [],
            },
          ],
          getReleases: async () => [],
          checkTrackAvailability: async () => ({ results: new Map(), interrupted: null }),
          resolve: async () => {
            throw new Error('Not used by sync.')
          },
        }
      },
    } as never as MusicConnectorModule
    const deps = {
      connectorsRepo: {
        get: async () => connector,
        markSynced: async () => undefined,
      },
      musicConnectors: new Map([['fake-music', module]]),
      musicCollectionsRepo: {
        listForConnector: async () => [
          {
            id: 'collection-1',
            kind: 'playlist',
            provider: 'fake-music',
            externalId: 'playlist-1',
            title: 'Playlist',
            description: null,
            coverUrl: null,
            ownerName: null,
            trackCount: 0,
            libraryAddedAt: '2026-07-21T00:00:00.000Z',
            remoteUpdatedAt: null,
            lastSyncedAt: null,
            createdAt: '2026-07-21T00:00:00.000Z',
            updatedAt: '2026-07-21T00:00:00.000Z',
          },
        ],
        upsert: async (_userId: string, input: Record<string, unknown>) => ({
          id: 'collection-1',
          userId: 'user-1',
          createdAt: '2026-07-21T00:00:00.000Z',
          updatedAt: '2026-07-21T00:00:00.000Z',
          ...input,
        }),
        replaceTracks,
        updateSnapshot: async () => null,
        deleteMissingConnectorCollections: async () => undefined,
        clearTrackAvailabilities: async () => undefined,
        listTracksForAvailabilityCheck: async () => [],
      },
      mediaSubscriptionsRepo: { find: async () => null },
    } as never as Deps

    await expect(
      syncConnector(deps, { CONNECTOR_CREDENTIALS_SECRET: secret } as Env, 'user-1', connector.id, 'manual'),
    ).resolves.toEqual({ capability: 'music.playlists.read', playlists: 1, selectedPlaylists: 1, tracks: 1 })
    expect(replaceTracks).toHaveBeenCalledWith('collection-1', [
      expect.objectContaining({ provider: 'fake-music', externalId: 'track-1' }),
    ])
  })
})
