import {
  decryptConnectorCredentials,
  decryptConnectorPayload,
  encryptConnectorPayload,
} from '@server/domain/connector-credentials'
import type { Env } from '@server/env'
import type { CreateDownloadResult, MusicDownloadQuality, MusicTrackDownloadInput } from '@shared/types'
import type { Deps } from './deps'
import { submitDownload } from './downloaders'
import { musicLaneKey } from './media-subscriptions'
import {
  type ConnectorRecord,
  type DownloadRecordRecord,
  MusicResourceUnavailableError,
  type MusicTrackRecord,
  type ResolvedMusicResource,
} from './ports'

const MUSIC_DOWNLOAD_KEY_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_MUSIC_DOWNLOAD_QUALITY: MusicDownloadQuality = 'exhigh'

export class MusicDownloadError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 401 | 404 | 409 | 410 | 502,
  ) {
    super(message)
    this.name = 'MusicDownloadError'
  }
}

export async function submitMusicTrackDownload(
  deps: Deps,
  userId: string,
  trackId: string,
  input: MusicTrackDownloadInput,
): Promise<CreateDownloadResult> {
  const track = await deps.musicCollectionsRepo.getLibraryTrack(userId, trackId)
  if (!track) throw new MusicDownloadError('Music track was not found in the library.', 404)
  if (track.provider !== 'netease') {
    throw new MusicDownloadError('This music provider does not support direct downloads.', 400)
  }

  const connector = await deps.connectorsRepo.findByKind(userId, 'netease')
  if (!connector?.enabled || connector.status !== 'connected' || !connector.credentialsEncrypted) {
    throw new MusicDownloadError('The Netease connector is not available.', 409)
  }
  const downloader = await deps.downloadersRepo.getEnabled(userId, input.downloaderId)
  if (!downloader) throw new MusicDownloadError('Downloader is not available.', 404)
  if (!deps.downloaderGateways[downloader.kind].supportedSourceTypes.includes('http')) {
    throw new MusicDownloadError(`${downloader.kind} does not support HTTP file downloads.`, 400)
  }

  const now = new Date().toISOString()
  const laneKey = musicLaneKey(connector.id)
  const quality = input.quality ?? DEFAULT_MUSIC_DOWNLOAD_QUALITY
  let current = (await deps.downloadRecordsRepo.listByResourceKeys(userId, 'music_track', [track.mediaKey]))[0]
  let downloadRecordId: string | null = null

  if (!current) {
    const record: DownloadRecordRecord = {
      id: crypto.randomUUID(),
      userId,
      resourceKind: 'music_track',
      resourceKey: track.mediaKey,
      laneKey,
      generation: 1,
      downloaderId: input.downloaderId,
      config: { preferredQuality: quality, resolvedQuality: null },
      status: 'queued',
      attemptCount: 0,
      externalTaskId: null,
      firstAcceptedAt: null,
      lastAcceptedAt: null,
      manualRequestedAt: now,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    }
    const created = await deps.downloadRecordsRepo.create(record)
    if (created) {
      downloadRecordId = record.id
    } else {
      current = (await deps.downloadRecordsRepo.listByResourceKeys(userId, 'music_track', [track.mediaKey]))[0]
      if (!current) throw new MusicDownloadError('Music download record disappeared while it was queued.', 409)
    }
  }

  if (current) {
    if (current.status === 'accepted' && !input.force) {
      throw new MusicDownloadError('This music track was already submitted. Choose download again to continue.', 409)
    }
    if (current.status === 'queued' || current.status === 'resolving' || current.status === 'submitting') {
      if (!current.manualRequestedAt) {
        await deps.downloadRecordsRepo.update(current.id, current.generation, {
          manualRequestedAt: now,
          updatedAt: now,
        })
      }
      downloadRecordId = current.id
    } else {
      const updated = await deps.downloadRecordsRepo.update(current.id, current.generation, {
        laneKey,
        generation: current.generation + 1,
        downloaderId: input.downloaderId,
        config: { preferredQuality: quality, resolvedQuality: null },
        status: 'queued',
        attemptCount: 0,
        externalTaskId: null,
        manualRequestedAt: now,
        errorMessage: null,
        updatedAt: now,
      })
      if (!updated) throw new MusicDownloadError('Music download record changed while it was queued.', 409)
      downloadRecordId = updated.id
    }
  }

  if (!downloadRecordId) throw new Error('Music download record was not queued.')
  await deps.downloadDispatchQueue.wake(laneKey)
  return { downloaderId: input.downloaderId, downloadRecordId, status: 'queued' }
}

export async function dispatchMusicDownloadRecord(
  deps: Deps,
  env: Env,
  record: DownloadRecordRecord,
  connectorId: string,
): Promise<void> {
  const track = await deps.musicCollectionsRepo.getTrackByMediaKey(record.resourceKey)
  if (!track) throw new MusicDownloadError('Music track was not found.', 404)
  if (!record.downloaderId) throw new MusicDownloadError('Downloader is not available.', 404)
  const connector = await deps.connectorsRepo.get(record.userId, connectorId)
  if (!connector?.enabled || connector.status !== 'connected' || !connector.credentialsEncrypted) {
    throw new MusicDownloadError('The Netease connector is not available.', 409)
  }

  let resource: ResolvedMusicResource
  try {
    resource = await resolvePreferredTrackResource(deps, env, track, connector, record.config.preferredQuality, 2_000)
    await setTrackAvailability(deps, record.userId, track.id, 'available')
  } catch (error) {
    await setTrackAvailability(
      deps,
      record.userId,
      track.id,
      error instanceof MusicResourceUnavailableError ? 'unavailable' : 'unknown',
    )
    throw error
  }

  if (!(await deps.downloadRecordsRepo.isWanted(record.id))) {
    await deps.downloadRecordsRepo.update(record.id, record.generation, {
      status: 'canceled',
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    })
    return
  }

  const key = createAccessKey()
  const now = new Date()
  const access = {
    id: crypto.randomUUID(),
    keyHash: await hashAccessKey(key),
    userId: record.userId,
    connectorId: connector.id,
    trackId: track.id,
    downloaderId: record.downloaderId,
    quality: resource.quality,
    resourceEncrypted: await encryptConnectorPayload(env.CONNECTOR_CREDENTIALS_SECRET, resource),
    expiresAt: new Date(now.getTime() + MUSIC_DOWNLOAD_KEY_TTL_MS).toISOString(),
    revokedAt: null,
    createdAt: now.toISOString(),
  }
  await deps.musicDownloadKeysRepo.create(access)
  await deps.downloadRecordsRepo.update(record.id, record.generation, {
    config: { ...record.config, resolvedQuality: resource.quality },
    status: 'submitting',
    updatedAt: now.toISOString(),
  })

  const downloadUrl = new URL(`/api/music/tracks/${encodeURIComponent(track.id)}/download`, env.PUBLIC_APP_ORIGIN)
  downloadUrl.searchParams.set('key', key)
  try {
    const result = await submitDownload(deps, record.userId, {
      downloaderId: record.downloaderId,
      sourceType: 'http',
      uri: downloadUrl.toString(),
      title: buildMusicFilename(track.artists, track.title, resource.extension),
      category: 'zme:music',
      tags: [
        `downloadRecordId=${record.id}`,
        `generation=${record.generation}`,
        `mediaKey=${track.mediaKey}`,
        'kind=music',
      ],
    })
    const acceptedAt = new Date().toISOString()
    await deps.downloadRecordsRepo.update(record.id, record.generation, {
      status: 'accepted',
      externalTaskId: result.externalTaskId ?? null,
      firstAcceptedAt: record.firstAcceptedAt ?? acceptedAt,
      lastAcceptedAt: acceptedAt,
      errorMessage: null,
      updatedAt: acceptedAt,
    })
  } catch (error) {
    await deps.musicDownloadKeysRepo.revoke(access.id, new Date().toISOString())
    throw error
  }
}

export async function resolveMusicTrackDownload(
  deps: Deps,
  env: Env,
  trackId: string,
  key: string,
): Promise<{ resource: ResolvedMusicResource; filename: string }> {
  const access = await deps.musicDownloadKeysRepo.getByHash(await hashAccessKey(key))
  if (!access || access.trackId !== trackId || access.revokedAt) {
    throw new MusicDownloadError('Music download key is invalid.', 401)
  }
  if (Date.parse(access.expiresAt) <= Date.now()) {
    throw new MusicDownloadError('Music download key has expired.', 410)
  }

  const track = await deps.musicCollectionsRepo.getTrack(access.trackId)
  if (!track) throw new MusicDownloadError('Music track was not found.', 404)
  if (track.provider !== 'netease') {
    throw new MusicDownloadError('This music provider does not support direct downloads.', 400)
  }

  if (access.resourceEncrypted) {
    const resource = parseResolvedMusicResource(
      await decryptConnectorPayload(env.CONNECTOR_CREDENTIALS_SECRET, access.resourceEncrypted),
    )
    return { resource, filename: buildMusicFilename(track.artists, track.title, resource.extension) }
  }

  const connector = await deps.connectorsRepo.get(access.userId, access.connectorId)
  if (!connector?.enabled || connector.status !== 'connected' || !connector.credentialsEncrypted) {
    throw new MusicDownloadError('The Netease connector is not available.', 409)
  }

  try {
    const resource = await resolveTrackResource(deps, env, track, connector, access.quality)
    await setTrackAvailability(deps, access.userId, track.id, 'available')
    return {
      resource,
      filename: buildMusicFilename(track.artists, track.title, resource.extension),
    }
  } catch (error) {
    await setTrackAvailability(
      deps,
      access.userId,
      track.id,
      error instanceof MusicResourceUnavailableError ? 'unavailable' : 'unknown',
    )
    throw toResolutionError(error)
  }
}

async function setTrackAvailability(
  deps: Deps,
  userId: string,
  trackId: string,
  status: 'available' | 'unavailable' | 'unknown',
): Promise<void> {
  await deps.musicCollectionsRepo.setTrackAvailabilities(userId, [
    { trackId, status, checkedAt: new Date().toISOString() },
  ])
}

async function resolveTrackResource(
  deps: Deps,
  env: Env,
  track: MusicTrackRecord,
  connector: ConnectorRecord,
  quality: MusicDownloadQuality,
): Promise<ResolvedMusicResource> {
  if (!connector.credentialsEncrypted) throw new Error('Netease connector has no credentials.')
  const credentials = await decryptConnectorCredentials(
    env.CONNECTOR_CREDENTIALS_SECRET,
    connector.credentialsEncrypted,
  )
  return deps.musicResourceResolvers.netease.resolve(credentials, {
    trackId: track.externalId,
    quality,
  })
}

async function resolvePreferredTrackResource(
  deps: Deps,
  env: Env,
  track: MusicTrackRecord,
  connector: ConnectorRecord,
  preferredQuality: MusicDownloadQuality,
  fallbackDelayMs = 0,
): Promise<ResolvedMusicResource> {
  let unavailable: MusicResourceUnavailableError | null = null
  const qualities = qualityFallbacks(preferredQuality)
  for (const [index, quality] of qualities.entries()) {
    try {
      return await resolveTrackResource(deps, env, track, connector, quality)
    } catch (error) {
      if (!(error instanceof MusicResourceUnavailableError)) throw error
      unavailable = error
      if (fallbackDelayMs > 0 && index < qualities.length - 1) await delay(fallbackDelayMs)
    }
  }
  throw unavailable ?? new MusicResourceUnavailableError('The full track is not available for this account.')
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function parseResolvedMusicResource(value: unknown): ResolvedMusicResource {
  if (typeof value !== 'object' || value === null) throw new Error('Stored music resource is invalid.')
  const resource = value as Record<string, unknown>
  if (
    typeof resource.url !== 'string' ||
    typeof resource.headers !== 'object' ||
    resource.headers === null ||
    !['standard', 'exhigh', 'lossless', 'hires'].includes(String(resource.quality)) ||
    typeof resource.extension !== 'string'
  ) {
    throw new Error('Stored music resource is invalid.')
  }
  return value as ResolvedMusicResource
}

function qualityFallbacks(preferred: MusicDownloadQuality): MusicDownloadQuality[] {
  if (preferred === 'hires') return ['hires', 'lossless', 'exhigh', 'standard']
  if (preferred === 'lossless') return ['lossless', 'exhigh', 'standard']
  if (preferred === 'exhigh') return ['exhigh', 'standard']
  return ['standard']
}

function toResolutionError(error: unknown): MusicDownloadError {
  const message = error instanceof Error ? error.message : 'Music resource resolution failed.'
  return new MusicDownloadError(message, error instanceof MusicResourceUnavailableError ? 409 : 502)
}

function createAccessKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

async function hashAccessKey(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function buildMusicFilename(artists: string[], title: string, extension: string): string {
  const raw = `${artists.join(', ') || 'Unknown Artist'} - ${title}`.replace(/[\\/:*?"<>|]/g, '_')
  const basename = [...raw]
    .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .join('')
    .trim()
    .slice(0, 180)
  return `${basename || 'track'}.${extension}`
}
