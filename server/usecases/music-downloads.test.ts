import { encryptConnectorCredentials } from '@server/domain/connector-credentials'
import type { Env } from '@server/env'
import type { Deps } from '@server/usecases/deps'
import {
  type ConnectorRecord,
  type MusicDownloadKeyRecord,
  MusicResourceUnavailableError,
  type MusicTrackRecord,
} from '@server/usecases/ports'
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
    const secret = 'music-download-test-secret-at-least-32-characters'
    const encrypted = await encryptConnectorCredentials(secret, ['MUSIC_U=session-value'])
    const accesses: MusicDownloadKeyRecord[] = []
    const submittedInputs: { uri: string; sourceType: string; title?: string }[] = []
    const deps = {
      musicCollectionsRepo: {
        getLibraryTrack: async () => track,
        setTrackAvailabilities: async () => undefined,
      },
      connectorsRepo: { findByKind: async () => ({ ...connector, credentialsEncrypted: encrypted }) },
      musicDownloadKeysRepo: {
        create: async (record: MusicDownloadKeyRecord) => {
          accesses.push(record)
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
            submittedInputs.push(input)
          },
        },
      },
      musicResourceResolvers: {
        netease: {
          resolve: async () => ({
            url: 'https://m701.music.126.net/audio.mp3',
            headers: {},
            quality: 'exhigh',
            extension: 'mp3',
            contentType: 'audio/mpeg',
            contentLength: 4096,
          }),
        },
      },
    } as never as Deps

    await expect(
      submitMusicTrackDownload(
        deps,
        { CONNECTOR_CREDENTIALS_SECRET: secret } as never as Env,
        'user-1',
        'track-1',
        { downloaderId: 'downloader-1' },
        'https://zme.test',
      ),
    ).resolves.toEqual({ downloaderId: 'downloader-1', status: 'submitted' })

    const access = accesses[0]
    const submitted = submittedInputs[0]
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
      quality: 'exhigh',
      extension: 'mp3',
      contentType: 'audio/mpeg',
      contentLength: 4096,
    })
    const deps = {
      musicDownloadKeysRepo: { getByHash: async () => access },
      musicCollectionsRepo: { getTrack: async () => track, setTrackAvailabilities: async () => undefined },
      connectorsRepo: { get: async () => ({ ...connector, credentialsEncrypted: encrypted }) },
      musicResourceResolvers: { netease: { resolve } },
    } as never as Deps
    const env = { CONNECTOR_CREDENTIALS_SECRET: secret } as never as Env

    await expect(resolveMusicTrackDownload(deps, env, 'track-1', 'temporary-key')).resolves.toEqual({
      resource: {
        url: 'https://m701.music.126.net/audio.mp3',
        headers: {},
        quality: 'exhigh',
        extension: 'mp3',
        contentType: 'audio/mpeg',
        contentLength: 4096,
      },
      filename: 'Artist - Track Name.mp3',
    })
    expect(resolve).toHaveBeenCalledWith(['MUSIC_U=session-value'], { trackId: '123', quality: 'exhigh' })
  })

  it('rejects an unavailable track before creating a key or remote task', async () => {
    const secret = 'music-download-test-secret-at-least-32-characters'
    const encrypted = await encryptConnectorCredentials(secret, ['MUSIC_U=session-value'])
    const create = vi.fn()
    const submit = vi.fn()
    const setTrackAvailabilities = vi.fn()
    const deps = {
      musicCollectionsRepo: {
        getLibraryTrack: async () => track,
        setTrackAvailabilities,
      },
      connectorsRepo: { findByKind: async () => ({ ...connector, credentialsEncrypted: encrypted }) },
      downloadersRepo: {
        getEnabled: async () => ({
          id: 'downloader-1',
          kind: 'zpan',
          config: { endpoint: 'https://zpan.test', credentials: {}, options: {} },
          enabled: true,
        }),
      },
      musicDownloadKeysRepo: { create },
      downloaderGateways: { zpan: { submit } },
      musicResourceResolvers: {
        netease: {
          resolve: async () => {
            throw new MusicResourceUnavailableError('The full Netease track is not available for this account.')
          },
        },
      },
    } as never as Deps

    await expect(
      submitMusicTrackDownload(
        deps,
        { CONNECTOR_CREDENTIALS_SECRET: secret } as never as Env,
        'user-1',
        'track-1',
        { downloaderId: 'downloader-1' },
        'https://zme.test',
      ),
    ).rejects.toMatchObject({
      message: 'The full Netease track is not available for this account.',
      status: 409,
    })
    expect(setTrackAvailabilities).toHaveBeenCalledWith('user-1', [
      { trackId: 'track-1', status: 'unavailable', checkedAt: expect.any(String) },
    ])
    expect(create).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })

  it('records transient preflight failures as unknown without submitting a task', async () => {
    const secret = 'music-download-test-secret-at-least-32-characters'
    const encrypted = await encryptConnectorCredentials(secret, ['MUSIC_U=session-value'])
    const create = vi.fn()
    const submit = vi.fn()
    const setTrackAvailabilities = vi.fn()
    const deps = {
      musicCollectionsRepo: { getLibraryTrack: async () => track, setTrackAvailabilities },
      connectorsRepo: { findByKind: async () => ({ ...connector, credentialsEncrypted: encrypted }) },
      downloadersRepo: {
        getEnabled: async () => ({
          id: 'downloader-1',
          kind: 'zpan',
          config: { endpoint: 'https://zpan.test', credentials: {}, options: {} },
          enabled: true,
        }),
      },
      musicDownloadKeysRepo: { create },
      downloaderGateways: { zpan: { submit } },
      musicResourceResolvers: {
        netease: { resolve: async () => Promise.reject(new Error('Netease request failed: 429')) },
      },
    } as never as Deps

    await expect(
      submitMusicTrackDownload(
        deps,
        { CONNECTOR_CREDENTIALS_SECRET: secret } as never as Env,
        'user-1',
        'track-1',
        { downloaderId: 'downloader-1' },
        'https://zme.test',
      ),
    ).rejects.toMatchObject({ message: 'Netease request failed: 429', status: 502 })
    expect(setTrackAvailabilities).toHaveBeenCalledWith('user-1', [
      { trackId: 'track-1', status: 'unknown', checkedAt: expect.any(String) },
    ])
    expect(create).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })

  it('falls back to standard quality before submitting the download', async () => {
    const secret = 'music-download-test-secret-at-least-32-characters'
    const encrypted = await encryptConnectorCredentials(secret, ['MUSIC_U=session-value'])
    const accesses: MusicDownloadKeyRecord[] = []
    const resolve = vi.fn().mockImplementation(async (_credentials, input: { quality: string }) => {
      if (input.quality === 'exhigh') {
        throw new MusicResourceUnavailableError('The requested quality is not available.')
      }
      return {
        url: 'https://m701.music.126.net/audio.mp3',
        headers: {},
        quality: 'standard',
        extension: 'mp3',
        contentType: 'audio/mpeg',
        contentLength: 2048,
      }
    })
    const deps = {
      musicCollectionsRepo: {
        getLibraryTrack: async () => track,
        setTrackAvailabilities: async () => undefined,
      },
      connectorsRepo: { findByKind: async () => ({ ...connector, credentialsEncrypted: encrypted }) },
      downloadersRepo: {
        getEnabled: async () => ({
          id: 'downloader-1',
          kind: 'zpan',
          config: { endpoint: 'https://zpan.test', credentials: {}, options: {} },
          enabled: true,
        }),
      },
      musicDownloadKeysRepo: {
        create: async (record: MusicDownloadKeyRecord) => {
          accesses.push(record)
        },
      },
      downloaderGateways: { zpan: { submit: async () => ({ downloaderId: 'downloader-1', status: 'submitted' }) } },
      musicResourceResolvers: { netease: { resolve } },
    } as never as Deps

    await expect(
      submitMusicTrackDownload(
        deps,
        { CONNECTOR_CREDENTIALS_SECRET: secret } as never as Env,
        'user-1',
        'track-1',
        { downloaderId: 'downloader-1' },
        'https://zme.test',
      ),
    ).resolves.toEqual({ downloaderId: 'downloader-1', status: 'submitted' })
    expect(resolve).toHaveBeenNthCalledWith(1, ['MUSIC_U=session-value'], { trackId: '123', quality: 'exhigh' })
    expect(resolve).toHaveBeenNthCalledWith(2, ['MUSIC_U=session-value'], { trackId: '123', quality: 'standard' })
    expect(accesses[0]).toMatchObject({ quality: 'standard' })
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
