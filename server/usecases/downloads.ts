import { readConfig } from '@server/config'
import type { Env } from '@server/env'
import { parseMusicTrackResourceRef, resolveReleaseResourceRef } from '@server/security/download-resource-ref'
import { DEFAULT_MUSIC_DOWNLOAD_QUALITY, getZmeDownloadResourceDirectory } from '@shared/download-metadata'
import type { DownloadTaskSummary } from '@shared/types'
import type { Deps } from './deps'
import { resolveDownloadInput, submitDownload } from './downloaders'
import { hashSecret } from './identity'
import { submitMusicTrackDownload } from './music-downloads'
import {
  type DownloadRecord,
  DownloadSubmissionRejectedError,
  DownloadSubmissionUnknownError,
  StaleWriteError,
} from './ports'
import {
  DownloadManagementUnsupportedError,
  DownloadNotTerminalError,
  IdempotencyConflictError,
  ResourceConflictError,
  ResourceNotFoundError,
  ResourceUpstreamError,
} from './resource-errors'

export interface CreateDownloadRequest {
  resourceRef: string
  downloaderId: string
}

export interface DownloadReconciliationMessage {
  type: 'download_reconciliation'
  userId: string
  downloadId: string
  traceparent?: string
}

export async function createDownload(
  deps: Deps,
  env: Env,
  userId: string,
  idempotencyKey: string,
  input: CreateDownloadRequest,
): Promise<DownloadRecord> {
  const requestHash = await hashSecret(JSON.stringify(input))
  const existing = await deps.downloadsRepo.findByIdempotency(userId, idempotencyKey)
  if (existing) {
    if (existing.requestHash !== requestHash) throw new IdempotencyConflictError()
    return existing
  }
  const downloader = await deps.downloadersRepo.getEnabled(userId, input.downloaderId)
  if (!downloader) throw new ResourceNotFoundError('Downloader not found.')
  const now = new Date().toISOString()
  const release = input.resourceRef.startsWith('release-ref:')
    ? await resolveReleaseResourceRef(
        requiredResourceRefSecret(readConfig(env).downloadResourceRefSecret),
        userId,
        input.resourceRef,
      )
    : null
  const musicKey = parseMusicTrackResourceRef(input.resourceRef)
  if (!release && !musicKey) throw new ResourceConflictError('The resourceRef type is unsupported.')
  const track = musicKey ? await deps.musicCollectionsRepo.getTrackByMediaKey(musicKey) : null
  if (musicKey && !track) throw new ResourceNotFoundError('Music track not found.')
  const unresolvedSpec = release
    ? {
        sourceType: release.sourceType,
        uri: release.uri,
        title: release.title,
        category: release.category,
        tags: downloadTags(release.tags),
      }
    : {
        sourceType: 'http' as const,
        uri: `internal:music-track:${track?.id}`,
        title: track?.title,
        category: 'zme:music',
        tags: downloadTags([]),
      }
  const resolvedInput = await resolveDownloadInput(deps, { downloaderId: input.downloaderId, ...unresolvedSpec })
  const spec = {
    sourceType: resolvedInput.sourceType,
    uri: resolvedInput.uri,
    title: resolvedInput.title,
    category: resolvedInput.category,
    targetSubdirectory: resolvedInput.targetSubdirectory,
    tags: resolvedInput.tags,
    targetFolder: downloadTargetFolder(downloader.config.options.targetFolder, resolvedInput.category),
  }
  if (!deps.downloaderGateways[downloader.kind].supportedSourceTypes.includes(spec.sourceType)) {
    throw new ResourceConflictError('The selected downloader does not support this resource.')
  }
  const record: DownloadRecord = {
    id: crypto.randomUUID(),
    userId,
    idempotencyKey,
    requestHash,
    resourceRef: input.resourceRef,
    resourceKind: release ? 'release' : 'music_track',
    resourceKey: release?.mediaKey ?? musicKey ?? '',
    downloaderId: input.downloaderId,
    spec,
    status: release ? 'submitting' : 'queued',
    stage: null,
    externalTaskId: null,
    downstreamStatus: null,
    downstreamRevision: null,
    downloadedBytes: 0,
    storageUploadedBytes: 0,
    totalBytes: null,
    downloadBps: 0,
    storageUploadBps: 0,
    resultObjectId: null,
    resultName: null,
    resultTargetFolder: null,
    error: null,
    suspensionCreatedAt: null,
    cancellationCreatedAt: null,
    legacyDownloadRecordId: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  }
  if (!(await deps.downloadsRepo.create(record))) {
    const raced = await deps.downloadsRepo.findByIdempotency(userId, idempotencyKey)
    if (!raced || raced.requestHash !== requestHash) throw new IdempotencyConflictError()
    return raced
  }
  try {
    if (release) {
      const submitted = await submitDownload(deps, userId, { downloaderId: input.downloaderId, ...spec }, record.id)
      const updated =
        (await deps.downloadsRepo.update(userId, record.id, record.updatedAt, {
          status: 'submitted',
          externalTaskId: submitted.externalTaskId ?? null,
        })) ?? record
      if (updated.externalTaskId) await deps.downloadReconciliationQueue?.enqueue({ userId, downloadId: updated.id }, 5)
      return updated
    }
    const queued = await submitMusicTrackDownload(
      deps,
      userId,
      track?.id ?? '',
      {
        downloaderId: input.downloaderId,
        quality: DEFAULT_MUSIC_DOWNLOAD_QUALITY,
        force: true,
      },
      record.id,
    )
    return (
      (await deps.downloadsRepo.update(userId, record.id, record.updatedAt, {
        status: 'queued',
        legacyDownloadRecordId: queued.downloadRecordId ?? null,
      })) ?? record
    )
  } catch (error) {
    if (error instanceof DownloadSubmissionUnknownError) {
      throw new ResourceUpstreamError('Download submission outcome is unknown; retry with the same Idempotency-Key.')
    }
    const message = error instanceof Error ? error.message : 'Download submission failed.'
    await deps.downloadsRepo.update(userId, record.id, record.updatedAt, {
      status: 'failed',
      error: message,
      completedAt: new Date().toISOString(),
    })
    if (error instanceof DownloadSubmissionRejectedError) throw new ResourceConflictError(message)
    throw error
  }
}

export function listDownloads(deps: Deps, userId: string, input: Parameters<Deps['downloadsRepo']['list']>[1]) {
  return deps.downloadsRepo.list(userId, input)
}

export function getDownload(deps: Deps, userId: string, id: string) {
  return deps.downloadsRepo.get(userId, id)
}

export async function processDownloadReconciliation(
  deps: Deps,
  message: DownloadReconciliationMessage,
): Promise<number | null> {
  const current = await deps.downloadsRepo.get(message.userId, message.downloadId)
  if (!current || isTerminal(current.status) || !current.externalTaskId) return null
  const downloader = await deps.downloadersRepo.get(message.userId, current.downloaderId)
  if (downloader?.kind !== 'zpan') return null
  const gateway = deps.downloadTaskGateways.zpan
  if (!gateway?.get) return null
  const owner = crypto.randomUUID()
  const laneKey = `download-reconciliation:${message.userId}:${current.downloaderId}`
  const acquiredAt = new Date()
  const lease = await deps.dispatchLanesRepo.acquire(
    laneKey,
    owner,
    acquiredAt.toISOString(),
    new Date(acquiredAt.getTime() + 30_000).toISOString(),
  )
  if (!lease.acquired) return 1
  try {
    const snapshot = await gateway.get(
      downloader.config,
      {
        downloaderId: downloader.id,
        downloaderName: downloader.description ?? 'ZPan downloader',
        downloaderKind: downloader.kind,
      },
      current.externalTaskId,
    )
    if (!snapshot) {
      await deps.downloadsRepo.update(message.userId, current.id, current.updatedAt, {
        status: 'failed',
        error: 'The downstream download task no longer exists.',
        completedAt: new Date().toISOString(),
      })
      return null
    }
    const status = snapshot.status
    const terminal = isTerminal(status)
    const updated = await deps.downloadsRepo.update(message.userId, current.id, current.updatedAt, {
      status,
      stage: snapshot.stage ?? null,
      downstreamStatus: snapshot.status,
      downstreamRevision: snapshot.downstreamRevision ?? null,
      downloadedBytes: snapshot.downloadedBytes,
      storageUploadedBytes: snapshot.storageUploadedBytes,
      totalBytes: snapshot.totalBytes,
      downloadBps: snapshot.downloadBps,
      storageUploadBps: snapshot.storageUploadBps,
      resultObjectId: snapshot.outputObjectId ?? null,
      resultName: terminal ? snapshot.name : null,
      resultTargetFolder: terminal ? snapshot.targetFolder : null,
      error: snapshot.errorMessage,
      completedAt: terminal ? new Date().toISOString() : null,
    })
    if (!updated) return 1
    return terminal ? null : 5
  } finally {
    const releasedAt = new Date().toISOString()
    await deps.dispatchLanesRepo.release(laneKey, owner, releasedAt, releasedAt)
  }
}

export async function recoverDownloadReconciliations(deps: Deps): Promise<void> {
  for (const download of await deps.downloadsRepo.listReconciliationCandidates(100)) {
    await deps.downloadReconciliationQueue?.enqueue({ userId: download.userId, downloadId: download.id })
  }
}

export async function suspendDownload(deps: Deps, userId: string, id: string): Promise<DownloadRecord> {
  const current = await ownedDownload(deps, userId, id)
  if (current.suspensionCreatedAt) return current
  return setManagedStatus(deps, userId, id, 'paused', {
    suspensionCreatedAt: new Date().toISOString(),
  })
}

export async function resumeDownload(deps: Deps, userId: string, id: string): Promise<DownloadRecord> {
  const current = await ownedDownload(deps, userId, id)
  if (!current.suspensionCreatedAt) throw new ResourceNotFoundError('Download suspension not found.')
  return setManagedStatus(deps, userId, id, 'queued', {
    suspensionCreatedAt: null,
  })
}

export async function cancelDownload(deps: Deps, userId: string, id: string): Promise<DownloadRecord> {
  const current = await ownedDownload(deps, userId, id)
  if (current.cancellationCreatedAt) return current
  return setManagedStatus(deps, userId, id, 'canceled', {
    cancellationCreatedAt: new Date().toISOString(),
  })
}

export async function deleteDownload(deps: Deps, userId: string, id: string): Promise<void> {
  const current = await ownedDownload(deps, userId, id)
  if (!['completed', 'failed', 'canceled'].includes(current.status)) {
    throw new DownloadNotTerminalError('Only a terminal download can be deleted.')
  }
  const { gateway, downloader } = await managedGateway(deps, userId, current)
  if (current.externalTaskId) {
    if (!gateway.delete) throw new DownloadManagementUnsupportedError('Download management is unsupported.')
    await gateway.delete(downloader.config, current.externalTaskId)
  }
  if (!(await deps.downloadsRepo.delete(userId, id, current.updatedAt))) throw new StaleWriteError()
}

async function setManagedStatus(
  deps: Deps,
  userId: string,
  id: string,
  downstreamStatus: 'paused' | 'queued' | 'canceled',
  patch: Partial<DownloadRecord>,
): Promise<DownloadRecord> {
  const current = await ownedDownload(deps, userId, id)
  const { gateway, downloader } = await managedGateway(deps, userId, current)
  if (!gateway.setStatus || !current.externalTaskId)
    throw new DownloadManagementUnsupportedError('Download management is unsupported.')
  let snapshot: DownloadTaskSummary
  try {
    snapshot = await gateway.setStatus(
      downloader.config,
      {
        downloaderId: downloader.id,
        downloaderName: downloader.description ?? 'ZPan downloader',
        downloaderKind: downloader.kind,
      },
      current.externalTaskId,
      downstreamStatus,
    )
  } catch (error) {
    throw new ResourceUpstreamError(error instanceof Error ? error.message : 'Downloader is unavailable.')
  }
  const update = {
    ...patch,
    status: snapshot.status,
    stage: snapshot.stage ?? null,
    downstreamStatus: snapshot.status,
    downstreamRevision: snapshot.downstreamRevision ?? null,
    downloadedBytes: snapshot.downloadedBytes,
    storageUploadedBytes: snapshot.storageUploadedBytes,
    totalBytes: snapshot.totalBytes,
    downloadBps: snapshot.downloadBps,
    storageUploadBps: snapshot.storageUploadBps,
    resultObjectId: snapshot.outputObjectId ?? null,
    resultName: isTerminal(snapshot.status) ? snapshot.name : null,
    resultTargetFolder: isTerminal(snapshot.status) ? snapshot.targetFolder : null,
    error: snapshot.errorMessage,
    completedAt: isTerminal(snapshot.status) ? new Date().toISOString() : null,
  }
  let updated = await deps.downloadsRepo.update(userId, id, current.updatedAt, update)
  if (!updated) {
    const latest = await ownedDownload(deps, userId, id)
    updated = await deps.downloadsRepo.update(userId, id, latest.updatedAt, update)
  }
  if (!updated) throw new StaleWriteError()
  if (updated.externalTaskId && !isTerminal(updated.status)) {
    await deps.downloadReconciliationQueue?.enqueue({ userId: updated.userId, downloadId: updated.id }, 5)
  }
  return updated
}

async function ownedDownload(deps: Deps, userId: string, id: string): Promise<DownloadRecord> {
  const current = await deps.downloadsRepo.get(userId, id)
  if (!current) throw new ResourceNotFoundError('Download not found.')
  return current
}

async function managedGateway(deps: Deps, userId: string, record: DownloadRecord) {
  const downloader = await deps.downloadersRepo.get(userId, record.downloaderId)
  if (downloader?.kind !== 'zpan') throw new DownloadManagementUnsupportedError('Download management is unsupported.')
  const gateway = deps.downloadTaskGateways.zpan
  if (!gateway) throw new DownloadManagementUnsupportedError('Download management is unsupported.')
  return { gateway, downloader }
}

function isTerminal(status: DownloadRecord['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled'
}

function requiredResourceRefSecret(value: string | undefined): string {
  if (!value) throw new Error('DOWNLOAD_RESOURCE_REF_SECRET is required.')
  return value
}

function downloadTags(tags: readonly string[]): string[] {
  return [...tags]
}

function downloadTargetFolder(root: string | undefined, category: string | undefined): string {
  return [root?.replace(/[\\/]+$/, ''), getZmeDownloadResourceDirectory(category)].filter(Boolean).join('/')
}
