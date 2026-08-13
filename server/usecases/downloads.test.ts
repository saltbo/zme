import { describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import { deleteDownload, processDownloadReconciliation, suspendDownload } from './downloads'
import type { DownloadRecord } from './ports'
import { DownloadManagementUnsupportedError, DownloadNotTerminalError } from './resource-errors'

describe('unified download management', () => {
  it('pauses a ZPan task without a caller-supplied revision', async () => {
    const current = download()
    const setStatus = vi.fn(async () => snapshot('paused'))
    const deps = managedDeps(current, { setStatus })

    await expect(suspendDownload(deps, current.userId, current.id)).resolves.toMatchObject({
      status: 'paused',
      suspensionCreatedAt: expect.any(String),
    })
    expect(setStatus).toHaveBeenCalledWith(expect.anything(), expect.anything(), current.externalTaskId, 'paused')
  })

  it('retries the local write after reconciliation changes the download revision', async () => {
    const current = download()
    const update = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...current, status: 'paused', updatedAt: '2026-08-05T00:02:00.000Z' })
    const deps = managedDeps(current, { setStatus: async () => snapshot('paused') }, update)

    await expect(suspendDownload(deps, current.userId, current.id)).resolves.toMatchObject({ status: 'paused' })
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('rejects deletion until the download is terminal', async () => {
    const current = download()
    await expect(deleteDownload(managedDeps(current), current.userId, current.id)).rejects.toBeInstanceOf(
      DownloadNotTerminalError,
    )
  })

  it('rejects management for a non-ZPan downloader', async () => {
    const current = download()
    await expect(
      suspendDownload(managedDeps(current, {}, undefined, 'aria2'), current.userId, current.id),
    ).rejects.toBeInstanceOf(DownloadManagementUnsupportedError)
  })

  it('marks an active download failed when reconciliation confirms the downstream task is gone', async () => {
    const current = download()
    const update = vi.fn(async (_userId, _id, _revision, patch) => ({ ...current, ...patch }))
    const deps = managedDeps(current, { get: async () => null }, update)

    await expect(
      processDownloadReconciliation(deps, {
        type: 'download_reconciliation',
        userId: current.userId,
        downloadId: current.id,
      }),
    ).resolves.toBeNull()
    expect(update).toHaveBeenCalledWith(
      current.userId,
      current.id,
      current.updatedAt,
      expect.objectContaining({ status: 'failed', completedAt: expect.any(String) }),
    )
  })
})

function managedDeps(
  current: DownloadRecord,
  gateway: Record<string, unknown> = {},
  update:
    | ((userId: string, id: string, revision: string, patch: Partial<DownloadRecord>) => Promise<DownloadRecord>)
    | undefined = async (_userId: string, _id: string, _revision: string, patch: Partial<DownloadRecord>) => ({
    ...current,
    ...patch,
    updatedAt: '2026-08-05T00:01:00.000Z',
  }),
  downloaderKind: 'zpan' | 'aria2' = 'zpan',
): Deps {
  return {
    downloadsRepo: { get: async () => current, update: update as NonNullable<typeof update> },
    downloadersRepo: {
      get: async () => ({
        id: current.downloaderId,
        userId: current.userId,
        description: 'ZPan',
        kind: downloaderKind,
        config: { endpoint: 'https://zpan.test', credentials: {}, options: {} },
      }),
    },
    downloadTaskGateways: { zpan: gateway },
    dispatchLanesRepo: {
      acquire: async (_key: string, _owner: string, acquiredAt: string) => ({
        acquired: true,
        lane: { key: 'lane', leaseOwner: null, leaseExpiresAt: null, nextAllowedAt: null, updatedAt: acquiredAt },
      }),
      release: async () => undefined,
    },
  } as never as Deps
}

function download(): DownloadRecord {
  return {
    id: 'download-1',
    userId: 'user-1',
    idempotencyKey: 'request-1',
    requestHash: 'hash-1',
    resourceRef: 'release-ref:v1:opaque',
    resourceKind: 'release',
    resourceKey: 'tmdb:movie:550',
    downloaderId: 'downloader-1',
    spec: { sourceType: 'magnet', uri: 'magnet:?xt=urn:btih:test' },
    status: 'running',
    stage: 'downloading',
    externalTaskId: 'zpan-task-1',
    downstreamStatus: 'running',
    downstreamRevision: null,
    downloadedBytes: 10,
    storageUploadedBytes: 0,
    totalBytes: 100,
    downloadBps: 1,
    storageUploadBps: 0,
    resultObjectId: null,
    resultName: null,
    resultTargetFolder: null,
    error: null,
    suspensionCreatedAt: null,
    cancellationCreatedAt: null,
    legacyDownloadRecordId: null,
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z',
    completedAt: null,
  }
}

function snapshot(status: 'paused') {
  return {
    id: 'zpan-task-1',
    downloaderId: 'downloader-1',
    downloaderName: 'ZPan',
    downloaderKind: 'zpan' as const,
    sourceType: 'magnet' as const,
    sourceUri: 'magnet:?xt=urn:btih:test',
    name: 'Example',
    targetFolder: '/media/Movies',
    category: 'zme:movie',
    tags: [],
    status,
    stage: null,
    downloadedBytes: 10,
    storageUploadedBytes: 0,
    totalBytes: 100,
    downloadBps: 0,
    storageUploadBps: 0,
    errorMessage: null,
  }
}
