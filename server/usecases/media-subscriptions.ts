import { DEFAULT_MUSIC_DOWNLOAD_QUALITY } from '@shared/download-metadata'
import type {
  MusicCollectionDetails,
  MusicDownloadRecordSummary,
  MusicSubscriptionInput,
  MusicSubscriptionMutationResult,
  MusicSubscriptionSummary,
} from '@shared/types'
import type { Deps } from './deps'
import type { DownloadRecordRecord, MediaSubscriptionRecord } from './ports'

export class MusicSubscriptionError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409,
  ) {
    super(message)
    this.name = 'MusicSubscriptionError'
  }
}

export async function getMusicCollectionWithSubscription(
  deps: Deps,
  userId: string,
  collectionId: string,
): Promise<MusicCollectionDetails | null> {
  const details = await deps.musicCollectionsRepo.getDetails(userId, collectionId)
  if (!details) return null
  const subscription = await deps.mediaSubscriptionsRepo.find(userId, 'music_collection', collectionId)
  const records = await deps.downloadRecordsRepo.listByResourceKeys(
    userId,
    'music_track',
    details.tracks.map((track) => track.mediaKey),
  )
  const recordsByKey = new Map(records.map((record) => [record.resourceKey, toDownloadSummary(record)]))
  return {
    ...details,
    subscription: subscription ? toSubscriptionSummary(subscription) : null,
    tracks: details.tracks.map((track) => ({
      ...track,
      downloadRecord: recordsByKey.get(track.mediaKey) ?? null,
    })),
  }
}

export async function enableMusicCollectionSubscription(
  deps: Deps,
  userId: string,
  collectionId: string,
  input: MusicSubscriptionInput,
): Promise<MusicSubscriptionMutationResult> {
  const collection = await deps.musicCollectionsRepo.get(userId, collectionId)
  if (!collection?.libraryAddedAt) throw new MusicSubscriptionError('Music collection was not found.', 404)
  if (
    collection.kind !== 'playlist' ||
    !collection.connectorId ||
    !deps.musicConnectors.get(collection.provider)?.definition.capabilities.includes('music.tracks.download')
  ) {
    throw new MusicSubscriptionError('Automatic downloads are only available for downloadable synced playlists.', 400)
  }
  const connector = await deps.connectorsRepo.get(userId, collection.connectorId)
  if (!connector?.enabled || connector.status !== 'connected') {
    throw new MusicSubscriptionError('Music connector is not available.', 409)
  }
  await requireHttpDownloader(deps, userId, input.downloaderId)

  const now = new Date().toISOString()
  const subscription = await deps.mediaSubscriptionsRepo.upsertMusicCollection(userId, collectionId, {
    downloaderId: input.downloaderId,
    now,
  })
  const result = await evaluateMusicSubscription(deps, subscription, collection.connectorId)
  return { subscription: toSubscriptionSummary(subscription), canceled: 0, ...result }
}

export async function disableMusicCollectionSubscription(
  deps: Deps,
  userId: string,
  collectionId: string,
): Promise<MusicSubscriptionMutationResult> {
  const current = await deps.mediaSubscriptionsRepo.find(userId, 'music_collection', collectionId)
  if (!current) throw new MusicSubscriptionError('Music subscription was not found.', 404)
  const now = new Date().toISOString()
  const subscription = await deps.mediaSubscriptionsRepo.disable(userId, current.id, now)
  if (!subscription) throw new MusicSubscriptionError('Music subscription was not found.', 404)
  const canceled = await deps.downloadRecordsRepo.cancelUnwantedForSubscription(subscription.id, now)
  return { subscription: toSubscriptionSummary(subscription), queued: 0, waiting: 0, skipped: 0, canceled }
}

export async function evaluateMusicCollectionSubscription(
  deps: Deps,
  userId: string,
  collectionId: string,
): Promise<void> {
  const subscription = await deps.mediaSubscriptionsRepo.find(userId, 'music_collection', collectionId)
  if (!subscription?.enabled) return
  const collection = await deps.musicCollectionsRepo.get(userId, collectionId)
  if (
    !collection?.connectorId ||
    collection.kind !== 'playlist' ||
    !deps.musicConnectors.get(collection.provider)?.definition.capabilities.includes('music.tracks.download')
  ) {
    return
  }
  await evaluateMusicSubscription(deps, subscription, collection.connectorId)
}

async function evaluateMusicSubscription(
  deps: Deps,
  subscription: MediaSubscriptionRecord,
  connectorId: string,
): Promise<{ queued: number; waiting: number; skipped: number }> {
  if (!subscription.downloaderId) throw new MusicSubscriptionError('Subscription downloader is unavailable.', 409)
  const details = await deps.musicCollectionsRepo.getDetails(subscription.userId, subscription.subjectKey)
  if (!details) throw new MusicSubscriptionError('Music collection was not found.', 404)

  const now = new Date().toISOString()
  const laneKey = musicLaneKey(connectorId)
  const existing = await deps.downloadRecordsRepo.listByResourceKeys(
    subscription.userId,
    'music_track',
    details.tracks.map((track) => track.mediaKey),
  )
  const recordsByKey = new Map(existing.map((record) => [record.resourceKey, record]))
  const newRecords: DownloadRecordRecord[] = []

  for (const track of details.tracks) {
    if (recordsByKey.has(track.mediaKey)) continue
    const status = track.downloadStatus === 'unavailable' ? 'waiting_source' : 'queued'
    newRecords.push({
      id: crypto.randomUUID(),
      userId: subscription.userId,
      resourceKind: 'music_track',
      resourceKey: track.mediaKey,
      laneKey,
      generation: 1,
      downloaderId: subscription.downloaderId,
      config: {
        preferredQuality: DEFAULT_MUSIC_DOWNLOAD_QUALITY,
        resolvedQuality: null,
        releaseId: track.release?.id ?? null,
      },
      status,
      attemptCount: 0,
      externalTaskId: null,
      firstAcceptedAt: null,
      lastAcceptedAt: null,
      manualRequestedAt: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    })
  }
  await deps.downloadRecordsRepo.createMany(newRecords)
  const currentRecords = await deps.downloadRecordsRepo.listByResourceKeys(
    subscription.userId,
    'music_track',
    details.tracks.map((track) => track.mediaKey),
  )
  const currentByKey = new Map(currentRecords.map((record) => [record.resourceKey, record]))
  let queued = 0
  let waiting = 0
  let skipped = 0
  const linkedRecordIds: string[] = []

  for (const track of details.tracks) {
    let record = currentByKey.get(track.mediaKey)
    if (!record) throw new Error(`Download record disappeared: ${track.mediaKey}`)
    if (record.status === 'canceled' && !record.firstAcceptedAt) {
      record =
        (await deps.downloadRecordsRepo.update(record.id, record.generation, {
          laneKey,
          generation: record.generation + 1,
          downloaderId: subscription.downloaderId,
          config: {
            preferredQuality: DEFAULT_MUSIC_DOWNLOAD_QUALITY,
            resolvedQuality: null,
            releaseId: track.release?.id ?? null,
          },
          status: track.downloadStatus === 'unavailable' ? 'waiting_source' : 'queued',
          attemptCount: 0,
          externalTaskId: null,
          errorMessage: null,
          updatedAt: now,
        })) ?? record
    } else if (record.status === 'waiting_source' && track.downloadStatus === 'available') {
      record =
        (await deps.downloadRecordsRepo.update(record.id, record.generation, {
          status: 'queued',
          attemptCount: 0,
          errorMessage: null,
          updatedAt: now,
        })) ?? record
    }

    linkedRecordIds.push(record.id)
    if (record.status === 'queued') queued += 1
    else if (record.status === 'waiting_source') waiting += 1
    else skipped += 1
  }

  await deps.downloadRecordsRepo.linkSubscriptionMany(subscription.id, linkedRecordIds, now)
  await deps.mediaSubscriptionsRepo.markEvaluated(subscription.id, now)
  if (queued > 0) await deps.downloadDispatchQueue.wake(laneKey)
  return { queued, waiting, skipped }
}

async function requireHttpDownloader(deps: Deps, userId: string, downloaderId: string) {
  const downloader = await deps.downloadersRepo.getEnabled(userId, downloaderId)
  if (!downloader) throw new MusicSubscriptionError('Downloader is not available.', 404)
  if (!deps.downloaderGateways[downloader.kind].supportedSourceTypes.includes('http')) {
    throw new MusicSubscriptionError('Downloader does not support HTTP file downloads.', 400)
  }
}

export function musicLaneKey(connectorId: string) {
  return `music:${connectorId}`
}

export function parseMusicLaneKey(laneKey: string): string | null {
  const prefix = 'music:'
  return laneKey.startsWith(prefix) && laneKey.length > prefix.length ? laneKey.slice(prefix.length) : null
}

export function toSubscriptionSummary(subscription: MediaSubscriptionRecord): MusicSubscriptionSummary {
  return {
    id: subscription.id,
    enabled: subscription.enabled,
    downloaderId: subscription.downloaderId,
    lastEvaluatedAt: subscription.lastEvaluatedAt,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
  }
}

export function toDownloadSummary(record: DownloadRecordRecord): MusicDownloadRecordSummary {
  return {
    id: record.id,
    generation: record.generation,
    downloaderId: record.downloaderId,
    preferredQuality: record.config.preferredQuality,
    resolvedQuality: record.config.resolvedQuality,
    status: record.status,
    firstAcceptedAt: record.firstAcceptedAt,
    lastAcceptedAt: record.lastAcceptedAt,
    errorMessage: record.errorMessage,
    updatedAt: record.updatedAt,
  }
}
