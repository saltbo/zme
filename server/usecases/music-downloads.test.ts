import { encryptConnectorCredentials } from '@server/domain/connector-credentials'
import type { Env } from '@server/env'
import type { Deps } from '@server/usecases/deps'
import type { ConnectorRecord, MusicDownloadKeyRecord, MusicTrackRecord } from '@server/usecases/ports'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveMusicTrackDownload, submitMusicTrackDownload } from './music-downloads'

const track: MusicTrackRecord = {
  id: 'track-1',
  provider: 'netease',
  externalId: '123',
  mediaKey: 'netease:track:123',
  title: 'Track Name',
  artists: ['Artist'],
  albumTitle: 'Album',
  albumExternalId: 'album-1',
  coverUrl: null,
  durationMs: 180_000,
  isrcs: [],
}

const connector: ConnectorRecord = {
  id: 'connector-1',
  userId: 'user-1',
  kind: 'netease',
  externalAccountId: '42',
  displayName: 'Music Fan',
  avatarUrl: null,
  settings: {},
  credentialsEncrypted: 'encrypted-credentials',
  status: 'connected',
  enabled: true,
  lastSyncedAt: null,
  lastError: null,
  lastResult: null,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
}

afterEach(() => vi.restoreAllMocks())

describe('music downloads', () => {
  it('creates a hashed resource key and submits the permanent track path as HTTP', async () => {
    let access: MusicDownloadKeyRecord | null = null
    let submitted: { uri: string; sourceType: string; title?: string } | null = null
    const deps = {
      musicCollectionsRepo: { getLibraryTrack: async () => track },
      connectorsRepo: { findByKind: async () => connector },
      musicDownloadKeysRepo: {
        create: async (record: MusicDownloadKeyRecord) => {
          access = record
        },
        revoke: async () => undefined,
      },
      downloadersRepo: {
        getEnabled: async () => ({
          id: 'downloader-1',
          description: 'ZPan',
          kind: 'zpan',
          config: { endpoint: 'https://zpan.test', credentials: {}, options: {} },
          enabled: true,
          healthStatus: 'online',
          healthMessage: null,
          healthCheckedAt: null,
          createdAt: '2026-07-20T00:00:00.000Z',
          updatedAt: '2026-07-20T00:00:00.000Z',
        }),
      },
      downloaderGateways: {
        zpan: {
          submit: async (_config: unknown, input: { uri: string; sourceType: string; title?: string }) => {
            submitted = input
          },
        },
      },
    } as never as Deps

    await expect(
      submitMusicTrackDownload(deps, 'user-1', 'track-1', { downloaderId: 'downloader-1' }, 'https://zme.test'),
    ).resolves.toEqual({ downloaderId: 'downloader-1', status: 'submitted' })

    expect(access).toMatchObject({
      userId: 'user-1',
      connectorId: 'connector-1',
      trackId: 'track-1',
      downloaderId: 'downloader-1',
      quality: 'exhigh',
      revokedAt: null,
    })
    expect(access?.keyHash).toMatch(/^[0-9a-f]{64}$/)
    expect(submitted).toMatchObject({ sourceType: 'http', title: 'Artist - Track Name.mp3' })
    const url = new URL(submitted?.uri ?? '')
    expect(url.pathname).toBe('/api/music/tracks/track-1/download')
    const key = url.searchParams.get('key') ?? ''
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)))
    const expectedHash = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    expect(access?.keyHash).toBe(expectedHash)
  })

  it('decrypts connector credentials only while resolving an authorized request', async () => {
    const secret = 'music-download-test-secret-at-least-32-characters'
    const encrypted = await encryptConnectorCredentials(secret, ['MUSIC_U=session-value'])
    const access: MusicDownloadKeyRecord = {
      id: 'key-1',
      keyHash: 'stored-hash',
      userId: 'user-1',
      connectorId: 'connector-1',
      trackId: 'track-1',
      downloaderId: 'downloader-1',
      quality: 'exhigh',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      revokedAt: null,
      createdAt: new Date().toISOString(),
    }
    const resolve = vi.fn().mockResolvedValue({
      url: 'https://m701.music.126.net/audio.mp3',
      headers: {},
      extension: 'mp3',
      contentType: 'audio/mpeg',
      contentLength: 4096,
    })
    const deps = {
      musicDownloadKeysRepo: { getByHash: async () => access },
      musicCollectionsRepo: { getTrack: async () => track },
      connectorsRepo: { get: async () => ({ ...connector, credentialsEncrypted: encrypted }) },
      musicResourceResolvers: { netease: { resolve } },
    } as never as Deps
    const env = { CONNECTOR_CREDENTIALS_SECRET: secret } as never as Env

    await expect(resolveMusicTrackDownload(deps, env, 'track-1', 'temporary-key')).resolves.toEqual({
      resource: {
        url: 'https://m701.music.126.net/audio.mp3',
        headers: {},
        extension: 'mp3',
        contentType: 'audio/mpeg',
        contentLength: 4096,
      },
      filename: 'Artist - Track Name.mp3',
    })
    expect(resolve).toHaveBeenCalledWith(['MUSIC_U=session-value'], { trackId: '123', quality: 'exhigh' })
  })

  it('rejects an expired key before reading connector credentials', async () => {
    const getTrack = vi.fn()
    const deps = {
      musicDownloadKeysRepo: {
        getByHash: async () => ({
          id: 'key-1',
          keyHash: 'stored-hash',
          userId: 'user-1',
          connectorId: 'connector-1',
          trackId: 'track-1',
          downloaderId: 'downloader-1',
          quality: 'exhigh',
          expiresAt: new Date(Date.now() - 1_000).toISOString(),
          revokedAt: null,
          createdAt: new Date().toISOString(),
        }),
      },
      musicCollectionsRepo: { getTrack },
    } as never as Deps

    await expect(
      resolveMusicTrackDownload(
        deps,
        { CONNECTOR_CREDENTIALS_SECRET: 'unused' } as never as Env,
        'track-1',
        'expired-key',
      ),
    ).rejects.toMatchObject({ message: 'Music download key has expired.', status: 410 })
    expect(getTrack).not.toHaveBeenCalled()
  })
})
