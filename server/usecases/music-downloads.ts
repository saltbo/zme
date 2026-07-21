import { decryptConnectorCredentials } from '@server/domain/connector-credentials'
import type { Env } from '@server/env'
import type { CreateDownloadResult, MusicDownloadQuality, MusicTrackDownloadInput } from '@shared/types'
import type { Deps } from './deps'
import { submitDownload } from './downloaders'
import {
  type ConnectorRecord,
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
  env: Env,
  userId: string,
  trackId: string,
  input: MusicTrackDownloadInput,
  origin: string,
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
  if (downloader.kind !== 'zpan' && downloader.kind !== 'aria2') {
    throw new MusicDownloadError(`${downloader.kind} does not support HTTP file downloads.`, 400)
  }

  const quality = input.quality ?? DEFAULT_MUSIC_DOWNLOAD_QUALITY
  let preflight: ResolvedMusicResource
  try {
    preflight = await resolvePreferredTrackResource(deps, env, track, connector, quality)
    await setTrackAvailability(deps, userId, track.id, 'available')
  } catch (error) {
    await setTrackAvailability(
      deps,
      userId,
      track.id,
      error instanceof MusicResourceUnavailableError ? 'unavailable' : 'unknown',
    )
    throw toResolutionError(error)
  }

  const key = createAccessKey()
  const now = new Date()
  const record = {
    id: crypto.randomUUID(),
    keyHash: await hashAccessKey(key),
    userId,
    connectorId: connector.id,
    trackId: track.id,
    downloaderId: input.downloaderId,
    quality: preflight.quality,
    expiresAt: new Date(now.getTime() + MUSIC_DOWNLOAD_KEY_TTL_MS).toISOString(),
    revokedAt: null,
    createdAt: now.toISOString(),
  }
  await deps.musicDownloadKeysRepo.create(record)

  const downloadUrl = new URL(`/api/music/tracks/${encodeURIComponent(track.id)}/download`, origin)
  downloadUrl.searchParams.set('key', key)
  try {
    return await submitDownload(deps, userId, {
      downloaderId: input.downloaderId,
      sourceType: 'http',
      uri: downloadUrl.toString(),
      title: buildMusicFilename(track.artists, track.title, preflight.extension),
      category: 'zme:music',
      tags: [...track.artists, ...(track.albumTitle ? [track.albumTitle] : [])],
    })
  } catch (error) {
    await deps.musicDownloadKeysRepo.revoke(record.id, new Date().toISOString())
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
): Promise<ResolvedMusicResource> {
  let unavailable: MusicResourceUnavailableError | null = null
  for (const quality of qualityFallbacks(preferredQuality)) {
    try {
      return await resolveTrackResource(deps, env, track, connector, quality)
    } catch (error) {
      if (!(error instanceof MusicResourceUnavailableError)) throw error
      unavailable = error
    }
  }
  throw unavailable ?? new MusicResourceUnavailableError('The full track is not available for this account.')
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
