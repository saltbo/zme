import type { IndexerSearchItem } from '@shared/types'
import { EncryptJWT, jwtDecrypt } from 'jose'

const releaseRefPrefix = 'release-ref:v1:'
const musicTrackRefPrefix = 'music-track:'
const releaseRefLifetimeSeconds = 60 * 60

export interface ResolvedReleaseRef {
  kind: 'release'
  sourceType: 'magnet' | 'torrent_url'
  uri: string
  title: string
  mediaKey: string
  category: string
  tags: string[]
}

interface ReleaseRefClaims {
  kind: 'release'
  userId: string
  sourceType: ResolvedReleaseRef['sourceType']
  uri: string
  title: string
  mediaKey: string
  category: string
  tags: string[]
}

export class InvalidDownloadResourceRefError extends Error {
  constructor(message = 'The download resource reference is invalid or expired.') {
    super(message)
    this.name = 'InvalidDownloadResourceRefError'
  }
}

export async function issueReleaseResourceRef(
  secret: string,
  userId: string,
  mediaKey: string,
  item: IndexerSearchItem,
  now = new Date(),
): Promise<{ resourceRef: string; resourceRefExpiresAt: string }> {
  const source = releaseSource(item)
  if (!source) throw new InvalidDownloadResourceRefError('The release candidate has no downloadable source.')
  const expiresAt = new Date(now.getTime() + releaseRefLifetimeSeconds * 1000)
  const claims: ReleaseRefClaims = {
    kind: 'release',
    userId,
    ...source,
    title: item.title,
    mediaKey,
    category: releaseCategory(mediaKey, item),
    tags: releaseTags(mediaKey, item),
  }
  const token = await new EncryptJWT({ ...claims })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ: 'zme-release-ref+jwt' })
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .encrypt(await encryptionKey(secret))
  return { resourceRef: `${releaseRefPrefix}${token}`, resourceRefExpiresAt: expiresAt.toISOString() }
}

export async function resolveReleaseResourceRef(
  secret: string,
  userId: string,
  resourceRef: string,
): Promise<ResolvedReleaseRef> {
  if (!resourceRef.startsWith(releaseRefPrefix)) throw new InvalidDownloadResourceRefError()
  try {
    const { payload, protectedHeader } = await jwtDecrypt(
      resourceRef.slice(releaseRefPrefix.length),
      await encryptionKey(secret),
    )
    if (protectedHeader.typ !== 'zme-release-ref+jwt' || payload.kind !== 'release' || payload.userId !== userId) {
      throw new InvalidDownloadResourceRefError()
    }
    if (
      !['magnet', 'torrent_url'].includes(String(payload.sourceType)) ||
      typeof payload.uri !== 'string' ||
      typeof payload.title !== 'string' ||
      typeof payload.mediaKey !== 'string' ||
      typeof payload.category !== 'string' ||
      !Array.isArray(payload.tags) ||
      !payload.tags.every((tag) => typeof tag === 'string')
    ) {
      throw new InvalidDownloadResourceRefError()
    }
    return {
      kind: 'release',
      sourceType: payload.sourceType as ResolvedReleaseRef['sourceType'],
      uri: payload.uri,
      title: payload.title,
      mediaKey: payload.mediaKey,
      category: payload.category,
      tags: payload.tags as string[],
    }
  } catch (error) {
    if (error instanceof InvalidDownloadResourceRefError) throw error
    throw new InvalidDownloadResourceRefError()
  }
}

export function musicTrackResourceRef(mediaKey: string): string {
  return `${musicTrackRefPrefix}${mediaKey}`
}

export function parseMusicTrackResourceRef(resourceRef: string): string | null {
  if (!resourceRef.startsWith(musicTrackRefPrefix)) return null
  return resourceRef.slice(musicTrackRefPrefix.length).trim() || null
}

function releaseSource(item: IndexerSearchItem) {
  if (item.magnetUrl) return { sourceType: 'magnet' as const, uri: item.magnetUrl }
  if (item.downloadUrl) return { sourceType: 'torrent_url' as const, uri: item.downloadUrl }
  return null
}

function releaseCategory(mediaKey: string, item: IndexerSearchItem): string {
  if (item.downloadTarget) return `zme:${item.downloadTarget}`
  if (mediaKey.startsWith('tmdb:tv:')) return 'zme:series'
  if (mediaKey.startsWith('tmdb:movie:')) return 'zme:movie'
  throw new InvalidDownloadResourceRefError('The release candidate media type is unsupported.')
}

function releaseTags(mediaKey: string, item: IndexerSearchItem): string[] {
  const kind = mediaKey.startsWith('tmdb:tv:') ? 'series' : mediaKey.startsWith('tmdb:movie:') ? 'movie' : null
  return [
    `mediaKey=${mediaKey}`,
    `kind=${item.downloadTarget ?? kind}`,
    item.tmdbId ? `tmdbId=${item.tmdbId}` : null,
    item.imdbId ? `imdbId=${item.imdbId}` : null,
    item.tvdbId ? `tvdbId=${item.tvdbId}` : null,
  ].filter((tag): tag is string => Boolean(tag))
}

async function encryptionKey(secret: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)))
}
