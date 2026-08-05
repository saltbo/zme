import { analyzeIndexerRelease } from '@shared/release-analysis'
import type { DownloadTaskStatus, DownloadTaskSummary, IndexerSearchItem, MediaSearchItem } from '@shared/types'
import type { Deps } from './deps'
import { submitDownload } from './downloaders'
import { hashSecret } from './identity'
import { searchIndexers } from './indexers'
import { searchMedia } from './media'
import type {
  DownloaderRecord,
  ManualDownloadTaskRecord,
  ReleaseSearchJobRecord,
  ReleaseSearchResultRecord,
} from './ports'
import {
  DownloadSubmissionRejectedError,
  DownloadSubmissionUnknownError,
  IndexerNotConfiguredError,
  IndexerSearchError,
} from './ports'

export interface ReleaseSearchJobInput {
  mediaKey: string
  mediaTitle: string
  query: string
  searchType?: 'search' | 'audiosearch' | 'booksearch'
  categories?: number[]
}

const RELEASE_SEARCH_LEASE_MS = 5 * 60_000

export async function findMedia(deps: Deps, query: string, language?: string): Promise<MediaSearchItem[]> {
  return searchMedia(deps, query, language)
}

export async function listDownloadDestinations(deps: Deps, userId: string) {
  const records = await deps.downloadersRepo.listEnabled(userId)
  return records
    .filter((record) => Boolean(deps.downloadTaskGateways[record.kind]))
    .map((record) => ({
      id: record.id,
      name: record.description ?? `${record.kind} downloader`,
      kind: record.kind,
      healthStatus: record.healthStatus,
      supportedSourceTypes: [...deps.downloaderGateways[record.kind].supportedSourceTypes],
    }))
}

export async function createReleaseSearchJob(
  deps: Deps,
  userId: string,
  idempotencyKey: string,
  input: ReleaseSearchJobInput,
): Promise<ReleaseSearchJobRecord> {
  const normalized = {
    ...input,
    searchType: input.searchType ?? 'search',
    categories: [...(input.categories ?? [])].sort(),
  }
  const requestHash = await hashSecret(JSON.stringify(normalized))
  const existing = await deps.resourceApiRepo.findReleaseJobByIdempotency(userId, idempotencyKey)
  if (existing) {
    if (existing.requestHash !== requestHash) throw new IdempotencyConflictError()
    return existing
  }
  const now = new Date().toISOString()
  const record: ReleaseSearchJobRecord = {
    id: crypto.randomUUID(),
    userId,
    idempotencyKey,
    requestHash,
    ...normalized,
    status: 'running',
    error: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    createdAt: now,
    completedAt: null,
  }
  if (!(await deps.resourceApiRepo.createReleaseJob(record))) {
    const raced = await deps.resourceApiRepo.findReleaseJobByIdempotency(userId, idempotencyKey)
    if (!raced || raced.requestHash !== requestHash) throw new IdempotencyConflictError()
    return raced
  }
  return runReleaseSearchJob(deps, record)
}

export async function getReleaseSearchJob(deps: Deps, userId: string, id: string) {
  const job = await deps.resourceApiRepo.getReleaseJob(userId, id)
  if (job?.status !== 'running') return job
  return runReleaseSearchJob(deps, job)
}

async function runReleaseSearchJob(deps: Deps, record: ReleaseSearchJobRecord) {
  const leaseOwner = crypto.randomUUID()
  const claimedAt = new Date()
  const leaseExpiresAt = new Date(claimedAt.getTime() + RELEASE_SEARCH_LEASE_MS).toISOString()
  if (!(await deps.resourceApiRepo.claimReleaseJob(record.id, leaseOwner, claimedAt.toISOString(), leaseExpiresAt))) {
    return (await deps.resourceApiRepo.getReleaseJob(record.userId, record.id)) ?? record
  }
  const searchType = ['search', 'audiosearch', 'booksearch'].includes(record.searchType)
    ? (record.searchType as 'search' | 'audiosearch' | 'booksearch')
    : 'search'
  let items: IndexerSearchItem[]
  try {
    items = (await searchIndexers(deps, { ...record, searchType })).slice(0, 200)
  } catch (error) {
    if (!(error instanceof IndexerSearchError || error instanceof IndexerNotConfiguredError)) throw error
    const completedAt = new Date().toISOString()
    console.warn(
      JSON.stringify({
        event: 'release_search.failed',
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      }),
    )
    const message = 'Release search failed.'
    await deps.resourceApiRepo.failReleaseJob(record.id, leaseOwner, message, completedAt)
    return (await deps.resourceApiRepo.getReleaseJob(record.userId, record.id)) ?? record
  }
  const completedAt = new Date().toISOString()
  await deps.resourceApiRepo.completeReleaseJob(record.id, leaseOwner, items, completedAt)
  return (await deps.resourceApiRepo.getReleaseJob(record.userId, record.id)) ?? record
}

export async function createManualDownloadTask(
  deps: Deps,
  userId: string,
  idempotencyKey: string,
  input: { releaseSearchResultId: string; downloaderId: string },
): Promise<ManualDownloadTaskRecord> {
  const requestHash = await hashSecret(JSON.stringify(input))
  const existing = await deps.resourceApiRepo.findDownloadTaskByIdempotency(userId, idempotencyKey)
  if (existing) {
    if (existing.requestHash !== requestHash) throw new IdempotencyConflictError()
    return existing.status === 'submitting' ? submitPendingDownloadTask(deps, userId, existing) : existing
  }
  const result = await deps.resourceApiRepo.getReleaseResult(userId, input.releaseSearchResultId)
  if (!result) throw new ResourceNotFoundError('Release search result not found.')
  const downloader = await deps.downloadersRepo.getEnabled(userId, input.downloaderId)
  if (!downloader) throw new ResourceNotFoundError('Download destination not found.')
  if (!deps.downloadTaskGateways[downloader.kind]) {
    throw new ResourceConflictError('The selected download destination does not support task status tracking.')
  }
  const uri = result.item.magnetUrl ?? result.item.downloadUrl
  if (!uri) throw new ResourceConflictError('The selected release has no downloadable source.')
  const now = new Date().toISOString()
  const record: ManualDownloadTaskRecord = {
    id: crypto.randomUUID(),
    userId,
    idempotencyKey,
    requestHash,
    ...input,
    status: 'submitting',
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
    createdAt: now,
    completedAt: null,
  }
  if (!(await deps.resourceApiRepo.createDownloadTask(record))) {
    const raced = await deps.resourceApiRepo.findDownloadTaskByIdempotency(userId, idempotencyKey)
    if (!raced || raced.requestHash !== requestHash) throw new IdempotencyConflictError()
    return raced.status === 'submitting' ? submitPendingDownloadTask(deps, userId, raced) : raced
  }
  return submitPendingDownloadTask(deps, userId, record)
}

async function submitPendingDownloadTask(
  deps: Deps,
  userId: string,
  record: ManualDownloadTaskRecord,
): Promise<ManualDownloadTaskRecord> {
  const result = await deps.resourceApiRepo.getReleaseResult(userId, record.releaseSearchResultId)
  if (!result) throw new ResourceNotFoundError('Release search result not found.')
  const uri = result.item.magnetUrl ?? result.item.downloadUrl
  if (!uri) throw new ResourceConflictError('The selected release has no downloadable source.')
  try {
    const submission = await submitDownload(
      deps,
      userId,
      {
        downloaderId: record.downloaderId,
        uri,
        sourceType: result.item.magnetUrl ? 'magnet' : 'torrent_url',
        title: result.item.title,
      },
      record.id,
    )
    if (await deps.resourceApiRepo.markDownloadTaskSubmitted(record.id, submission)) {
      return { ...record, status: 'submitted', externalTaskId: submission.externalTaskId ?? null }
    }
    return (await deps.resourceApiRepo.getDownloadTask(userId, record.id)) ?? record
  } catch (error) {
    if (error instanceof DownloadSubmissionUnknownError) {
      throw new ResourceUpstreamError('Download submission outcome is unknown; retry with the same Idempotency-Key.')
    }
    if (!(error instanceof DownloadSubmissionRejectedError)) throw error
    const completedAt = new Date().toISOString()
    console.warn(
      JSON.stringify({
        event: 'download_task.failed',
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      }),
    )
    const message = 'Download submission failed.'
    if (await deps.resourceApiRepo.failDownloadTask(record.id, message, completedAt)) {
      return { ...record, status: 'failed', error: message, completedAt }
    }
    return (await deps.resourceApiRepo.getDownloadTask(userId, record.id)) ?? record
  }
}

export async function getManualDownloadTask(deps: Deps, userId: string, id: string) {
  const task = await deps.resourceApiRepo.getDownloadTask(userId, id)
  if (!task?.externalTaskId || !['submitted', 'running'].includes(task.status)) return task
  const downloader = await deps.downloadersRepo.get(userId, task.downloaderId)
  if (!downloader) return task
  const gateway = deps.downloadTaskGateways[downloader.kind]
  if (!gateway) return task

  let snapshot: DownloadTaskSummary | null
  try {
    if (!gateway.get) throw new Error('Download task gateway does not support exact task lookup')
    snapshot = await gateway.get(depsToConfig(downloader), depsToOwner(downloader), task.externalTaskId)
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: 'download_task.sync_failed',
        errorClass: error instanceof Error ? error.name : 'UnknownError',
        taskId: task.id,
      }),
    )
    throw new ResourceUpstreamError('Downloader task status is temporarily unavailable.')
  }
  if (!snapshot) return task

  const status = localTaskStatus(snapshot.status)
  const completedAt = ['completed', 'failed', 'canceled'].includes(status) ? new Date().toISOString() : null
  if (!(await deps.resourceApiRepo.syncDownloadTask(task.id, snapshot, status, completedAt))) {
    return deps.resourceApiRepo.getDownloadTask(userId, id)
  }
  return {
    ...task,
    status,
    downstreamStatus: snapshot.status,
    downstreamRevision: snapshot.downstreamRevision ?? null,
    downloadedBytes: snapshot.downloadedBytes,
    storageUploadedBytes: snapshot.storageUploadedBytes,
    totalBytes: snapshot.totalBytes,
    downloadBps: snapshot.downloadBps,
    storageUploadBps: snapshot.storageUploadBps,
    resultObjectId: snapshot.outputObjectId ?? null,
    resultName: status === 'completed' ? snapshot.name : null,
    resultTargetFolder: status === 'completed' ? snapshot.targetFolder : null,
    error: snapshot.errorMessage,
    completedAt,
  }
}

function depsToConfig(downloader: DownloaderRecord) {
  return downloader.config
}

function depsToOwner(downloader: DownloaderRecord) {
  return {
    downloaderId: downloader.id,
    downloaderName: downloader.description ?? `${downloader.kind} downloader`,
    downloaderKind: downloader.kind,
  }
}

function localTaskStatus(status: DownloadTaskStatus): ManualDownloadTaskRecord['status'] {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'canceled') return 'canceled'
  if (status === 'queued' || status === 'assigned') return 'submitted'
  return 'running'
}

export function releaseResultDetails(record: ReleaseSearchResultRecord) {
  const analysis = analyzeIndexerRelease(record.item)
  return {
    id: record.id,
    jobId: record.jobId,
    title: record.item.title,
    source: record.item.indexer,
    sizeBytes: record.item.size,
    quality: { source: analysis.source.label, resolution: analysis.resolution.label, hdr: analysis.hdr },
    encoding: { video: analysis.codec, audio: analysis.audio },
    availability: { seeders: record.item.seeders, leechers: record.item.leechers, protocol: record.item.protocol },
    publishedAt: record.item.publishDate,
  }
}

export class IdempotencyConflictError extends Error {}
export class ResourceNotFoundError extends Error {}
export class ResourceConflictError extends Error {}
export class ResourceUpstreamError extends Error {}
