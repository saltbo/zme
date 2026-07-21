import { encryptConnectorCredentials, encryptConnectorPayload } from '@server/domain/connector-credentials'
import type { Env } from '@server/env'
import type { Deps } from '@server/usecases/deps'
import {
  type ConnectorRecord,
  type DownloadRecordRecord,
  type MusicDownloadKeyRecord,
  MusicResourceUnavailableError,
  type MusicTrackRecord,
} from '@server/usecases/ports'
import type { CreateDownloadInput } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dispatchMusicDownloadRecord, resolveMusicTrackDownload, submitMusicTrackDownload } from './music-downloads'

const secret = 'music-download-test-secret-at-least-32-characters'
const env = {
  CONNECTOR_CREDENTIALS_SECRET: secret,
  PUBLIC_APP_ORIGIN: 'https://zme.test',
} as never as Env

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

const queuedRecord: DownloadRecordRecord = {
  id: 'download-1',
  userId: 'user-1',
  resourceKind: 'music_track',
  resourceKey: track.mediaKey,
  laneKey: 'netease:connector-1',
  generation: 1,
  downloaderId: 'downloader-1',
  config: { preferredQuality: 'exhigh', resolvedQuality: null },
  status: 'queued',
  attemptCount: 0,
  externalTaskId: null,
  firstAcceptedAt: null,
  lastAcceptedAt: null,
  manualRequestedAt: '2026-07-20T00:00:00.000Z',
  errorMessage: null,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
}

const downloader = {
  id: 'downloader-1',
  description: 'ZPan',
  kind: 'zpan' as const,
  config: { endpoint: 'https://zpan.test', credentials: {}, options: {} },
  enabled: true,
  healthStatus: 'online' as const,
  healthMessage: null,
  healthCheckedAt: null,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('music downloads', () => {
  it('persists a manual request and only wakes the connector lane', async () => {
    const records: DownloadRecordRecord[] = []
    const wake = vi.fn(async () => undefined)
    const resolve = vi.fn()
    const deps = {
      musicCollectionsRepo: { getLibraryTrack: async () => track },
      connectorsRepo: { findByKind: async () => connector },
      downloadersRepo: { getEnabled: async () => downloader },
      downloaderGateways: {
        zpan: { supportedSourceTypes: ['magnet', 'torrent_url', 'http'] },
      },
      downloadRecordsRepo: {
        listByResourceKeys: async () => records,
        create: async (record: DownloadRecordRecord) => {
          records.push(record)
          return true
        },
      },
      downloadDispatchQueue: { wake },
      musicResourceResolvers: { netease: { resolve } },
    } as never as Deps

    await expect(
      submitMusicTrackDownload(deps, 'user-1', 'track-1', { downloaderId: 'downloader-1' }),
    ).resolves.toMatchObject({
      downloaderId: 'downloader-1',
      downloadRecordId: expect.any(String),
      status: 'queued',
    })

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      resourceKind: 'music_track',
      resourceKey: 'netease:track:123',
      laneKey: 'netease:connector-1',
      status: 'queued',
      manualRequestedAt: expect.any(String),
    })
    expect(wake).toHaveBeenCalledOnce()
    expect(wake).toHaveBeenCalledWith('netease:connector-1')
    expect(resolve).not.toHaveBeenCalled()
  })

  it('requires explicit force before an accepted track can be queued again', async () => {
    let record: DownloadRecordRecord = {
      ...queuedRecord,
      status: 'accepted' as const,
      firstAcceptedAt: '2026-07-20T01:00:00.000Z',
      lastAcceptedAt: '2026-07-20T01:00:00.000Z',
    }
    const update = vi.fn(async (_id: string, generation: number, patch: Partial<DownloadRecordRecord>) => {
      if (generation !== record.generation) return null
      record = { ...record, ...patch }
      return record
    })
    const wake = vi.fn(async () => undefined)
    const deps = {
      musicCollectionsRepo: { getLibraryTrack: async () => track },
      connectorsRepo: { findByKind: async () => connector },
      downloadersRepo: { getEnabled: async () => downloader },
      downloaderGateways: { zpan: { supportedSourceTypes: ['http'] } },
      downloadRecordsRepo: { listByResourceKeys: async () => [record], update },
      downloadDispatchQueue: { wake },
    } as never as Deps

    await expect(
      submitMusicTrackDownload(deps, 'user-1', 'track-1', { downloaderId: 'downloader-1' }),
    ).rejects.toMatchObject({ status: 409 })
    expect(wake).not.toHaveBeenCalled()

    await expect(
      submitMusicTrackDownload(deps, 'user-1', 'track-1', { downloaderId: 'downloader-1', force: true }),
    ).resolves.toMatchObject({ status: 'queued' })
    expect(record).toMatchObject({ generation: 2, status: 'queued', attemptCount: 0 })
    expect(wake).toHaveBeenCalledWith('netease:connector-1')
  })

  it('resolves once in the consumer, stores an encrypted source, and submits the permanent ZME URL', async () => {
    const encrypted = await encryptConnectorCredentials(secret, ['MUSIC_U=session-value'])
    const accesses: MusicDownloadKeyRecord[] = []
    const updates: Partial<DownloadRecordRecord>[] = []
    const submittedInputs: CreateDownloadInput[] = []
    const submit = vi.fn(async (_config: unknown, input: CreateDownloadInput) => {
      submittedInputs.push(input)
      return { externalTaskId: 'remote-task-1' }
    })
    const deps = {
      musicCollectionsRepo: {
        getTrackByMediaKey: async () => track,
        setTrackAvailabilities: async () => undefined,
      },
      connectorsRepo: { get: async () => ({ ...connector, credentialsEncrypted: encrypted }) },
      downloadersRepo: { getEnabled: async () => downloader },
      downloadRecordsRepo: {
        isWanted: async () => true,
        update: async (_id: string, _generation: number, patch: Partial<DownloadRecordRecord>) => {
          updates.push(patch)
          return { ...queuedRecord, ...patch }
        },
      },
      musicDownloadKeysRepo: {
        create: async (record: MusicDownloadKeyRecord) => accesses.push(record),
        revoke: async () => undefined,
      },
      downloaderGateways: {
        zpan: { supportedSourceTypes: ['magnet', 'torrent_url', 'http'], submit },
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

    await dispatchMusicDownloadRecord(
      deps,
      env,
      { ...queuedRecord, status: 'resolving', attemptCount: 1 },
      connector.id,
    )

    expect(accesses[0]).toMatchObject({
      userId: 'user-1',
      connectorId: 'connector-1',
      trackId: 'track-1',
      downloaderId: 'downloader-1',
      quality: 'exhigh',
      resourceEncrypted: expect.any(String),
    })
    expect(accesses[0]?.resourceEncrypted).not.toContain('music.126.net')
    expect(submit).toHaveBeenCalledOnce()
    const submitted = submittedInputs[0]
    expect(submitted).toMatchObject({ sourceType: 'http', title: 'Artist - Track Name.mp3' })
    const url = new URL(submitted?.uri ?? '')
    expect(url.origin).toBe('https://zme.test')
    expect(url.pathname).toBe('/api/music/tracks/track-1/download')
    expect(url.searchParams.get('key')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(updates.at(-1)).toMatchObject({ status: 'accepted', externalTaskId: 'remote-task-1' })
  })

  it('serves a stored resolved source without calling Netease again', async () => {
    const resource = {
      url: 'https://m701.music.126.net/audio.mp3',
      headers: { Referer: 'https://music.163.com/' },
      quality: 'exhigh' as const,
      extension: 'mp3',
      contentType: 'audio/mpeg',
      contentLength: 4096,
    }
    const access: MusicDownloadKeyRecord = {
      id: 'key-1',
      keyHash: 'stored-hash',
      userId: 'user-1',
      connectorId: 'connector-1',
      trackId: 'track-1',
      downloaderId: 'downloader-1',
      quality: 'exhigh',
      resourceEncrypted: await encryptConnectorPayload(secret, resource),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      revokedAt: null,
      createdAt: new Date().toISOString(),
    }
    const getConnector = vi.fn()
    const resolve = vi.fn()
    const deps = {
      musicDownloadKeysRepo: { getByHash: async () => access },
      musicCollectionsRepo: { getTrack: async () => track },
      connectorsRepo: { get: getConnector },
      musicResourceResolvers: { netease: { resolve } },
    } as never as Deps

    await expect(resolveMusicTrackDownload(deps, env, 'track-1', 'temporary-key')).resolves.toEqual({
      resource,
      filename: 'Artist - Track Name.mp3',
    })
    expect(getConnector).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('waits between quality fallbacks before submitting', async () => {
    vi.useFakeTimers()
    const encrypted = await encryptConnectorCredentials(secret, ['MUSIC_U=session-value'])
    const resolve = vi.fn(async (_credentials, input: { quality: string }) => {
      if (input.quality === 'exhigh') throw new MusicResourceUnavailableError('Quality unavailable.')
      return {
        url: 'https://m701.music.126.net/audio.mp3',
        headers: {},
        quality: 'standard' as const,
        extension: 'mp3',
        contentType: 'audio/mpeg',
        contentLength: 2048,
      }
    })
    const deps = {
      musicCollectionsRepo: {
        getTrackByMediaKey: async () => track,
        setTrackAvailabilities: async () => undefined,
      },
      connectorsRepo: { get: async () => ({ ...connector, credentialsEncrypted: encrypted }) },
      downloadersRepo: { getEnabled: async () => downloader },
      downloadRecordsRepo: {
        isWanted: async () => true,
        update: async (_id: string, _generation: number, patch: Partial<DownloadRecordRecord>) => ({
          ...queuedRecord,
          ...patch,
        }),
      },
      musicDownloadKeysRepo: { create: async () => undefined, revoke: async () => undefined },
      downloaderGateways: {
        zpan: {
          supportedSourceTypes: ['http'],
          submit: async () => ({ externalTaskId: null }),
        },
      },
      musicResourceResolvers: { netease: { resolve } },
    } as never as Deps

    const dispatched = dispatchMusicDownloadRecord(
      deps,
      env,
      { ...queuedRecord, status: 'resolving', attemptCount: 1 },
      connector.id,
    )
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(1_999)
    expect(resolve).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await dispatched
    expect(resolve).toHaveBeenNthCalledWith(1, ['MUSIC_U=session-value'], { trackId: '123', quality: 'exhigh' })
    expect(resolve).toHaveBeenNthCalledWith(2, ['MUSIC_U=session-value'], { trackId: '123', quality: 'standard' })
  })

  it('rejects an expired key before reading the track', async () => {
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

    await expect(resolveMusicTrackDownload(deps, env, 'track-1', 'expired-key')).rejects.toMatchObject({
      message: 'Music download key has expired.',
      status: 410,
    })
    expect(getTrack).not.toHaveBeenCalled()
  })
})
