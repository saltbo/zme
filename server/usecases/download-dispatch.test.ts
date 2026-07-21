import { encryptConnectorCredentials } from '@server/domain/connector-credentials'
import type { Env } from '@server/env'
import { describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import { processDownloadDispatch } from './download-dispatch'
import type { DownloadRecordRecord } from './ports'

const laneKey = 'netease:connector-1'

function downloadRecord(id: string, resourceKey: string): DownloadRecordRecord {
  return {
    id,
    userId: 'user-1',
    resourceKind: 'music_track',
    resourceKey,
    laneKey,
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
}

describe('download dispatch lanes', () => {
  it('submits one track, releases the lane for ten seconds, then wakes the next record', async () => {
    const encrypted = await encryptConnectorCredentials('music-download-test-secret-at-least-32-characters', [
      'MUSIC_U=session-value',
    ])
    const records = [downloadRecord('download-1', 'netease:track:1'), downloadRecord('download-2', 'netease:track:2')]
    const wake = vi.fn(async () => undefined)
    const released: { args: [string, string, string, string] | null } = { args: null }
    const release = vi.fn(async (...args: [string, string, string, string]) => {
      released.args = args
    })
    const submit = vi.fn(async () => ({ externalTaskId: 'remote-1' }))
    const deps = {
      dispatchLanesRepo: {
        acquire: async (_key: string, owner: string, acquiredAt: string, leaseExpiresAt: string) => ({
          acquired: true,
          lane: {
            key: laneKey,
            leaseOwner: owner,
            leaseExpiresAt,
            nextAllowedAt: null,
            updatedAt: acquiredAt,
          },
        }),
        release,
      },
      downloadRecordsRepo: {
        requeueStalled: async () => [],
        claimNext: async () => {
          const record = records.find((item) => item.status === 'queued')
          if (!record) return null
          record.status = 'resolving'
          record.attemptCount += 1
          return { ...record }
        },
        isWanted: async () => true,
        update: async (id: string, generation: number, patch: Partial<DownloadRecordRecord>) => {
          const record = records.find((item) => item.id === id && item.generation === generation)
          if (!record) return null
          Object.assign(record, patch)
          return { ...record }
        },
        hasQueued: async () => records.some((record) => record.status === 'queued'),
      },
      musicCollectionsRepo: {
        getTrackByMediaKey: async (mediaKey: string) => ({
          id: `track-${mediaKey.at(-1)}`,
          provider: 'netease' as const,
          externalId: mediaKey.at(-1) ?? '',
          mediaKey,
          title: `Track ${mediaKey.at(-1)}`,
          artists: ['Artist'],
          albumTitle: null,
          albumExternalId: null,
          coverUrl: null,
          durationMs: null,
          isrcs: [],
        }),
        setTrackAvailabilities: async () => undefined,
      },
      connectorsRepo: {
        get: async () => ({
          id: 'connector-1',
          userId: 'user-1',
          kind: 'netease' as const,
          externalAccountId: 'account-1',
          displayName: 'Music Fan',
          avatarUrl: null,
          settings: {},
          credentialsEncrypted: encrypted,
          status: 'connected' as const,
          enabled: true,
          lastSyncedAt: null,
          lastError: null,
          lastResult: null,
          createdAt: '2026-07-20T00:00:00.000Z',
          updatedAt: '2026-07-20T00:00:00.000Z',
        }),
      },
      musicResourceResolvers: {
        netease: {
          resolve: async () => ({
            url: 'https://m701.music.126.net/audio.mp3',
            headers: {},
            quality: 'exhigh' as const,
            extension: 'mp3',
            contentType: 'audio/mpeg',
            contentLength: 2048,
          }),
        },
      },
      musicDownloadKeysRepo: { create: async () => undefined, revoke: async () => undefined },
      downloadersRepo: {
        getEnabled: async () => ({
          id: 'downloader-1',
          kind: 'zpan' as const,
          config: { endpoint: 'https://zpan.test', credentials: {}, options: {} },
          enabled: true,
        }),
      },
      downloaderGateways: { zpan: { supportedSourceTypes: ['http'], submit } },
      downloadDispatchQueue: { wake },
    } as never as Deps
    const env = {
      CONNECTOR_CREDENTIALS_SECRET: 'music-download-test-secret-at-least-32-characters',
      PUBLIC_APP_ORIGIN: 'https://zme.test',
    } as never as Env

    await expect(processDownloadDispatch(deps, env, { laneKey })).resolves.toEqual({ retryAfterSeconds: null })

    expect(records[0]).toMatchObject({ status: 'accepted', attemptCount: 1, externalTaskId: 'remote-1' })
    expect(records[1]).toMatchObject({ status: 'queued', attemptCount: 0 })
    expect(submit).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
    if (!released.args) throw new Error('Dispatch lane was not released.')
    const [, , nextAllowedAt, releasedAt] = released.args
    expect(Date.parse(nextAllowedAt ?? '') - Date.parse(releasedAt ?? '')).toBe(10_000)
    expect(wake).toHaveBeenCalledWith(laneKey, 10)
  })

  it('asks the queue to retry when the lane is still cooling down', async () => {
    const nextAllowedAt = new Date(Date.now() + 10_000).toISOString()
    const deps = {
      dispatchLanesRepo: {
        acquire: async () => ({
          acquired: false,
          lane: {
            key: laneKey,
            leaseOwner: null,
            leaseExpiresAt: null,
            nextAllowedAt,
            updatedAt: new Date().toISOString(),
          },
        }),
      },
    } as never as Deps

    const result = await processDownloadDispatch(deps, {} as Env, { laneKey })

    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(9)
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(10)
  })
})
