import { parseTmdbMediaKey } from '@shared/media-key'
import type { IndexerSearchItem } from '@shared/types'
import { EncryptJWT, jwtDecrypt } from 'jose'

const torrentRefPrefix = 'torrent-ref:v1:'
const musicTrackRefPrefix = 'music-track:'
const torrentRefLifetimeSeconds = 60 * 60

export interface ResolvedTorrentRef {
  kind: 'torrent'
  sourceType: 'magnet' | 'torrent_url'
  uri: string
  title: string
  mediaKey: string
  category: string
  tags: string[]
}

interface TorrentRefClaims {
  kind: 'torrent'
  userId: string
  sourceType: ResolvedTorrentRef['sourceType']
  uri: string
  title: string
  mediaKey: string
  category: string
  tags?: string[]
}

export class InvalidDownloadResourceRefError extends Error {
  constructor(message = 'The download resource reference is invalid or expired.') {
    super(message)
    this.name = 'InvalidDownloadResourceRefError'
  }
}

export async function issueTorrentResourceRef(
  secret: string,
  userId: string,
  mediaKey: string,
  item: IndexerSearchItem,
  now = new Date(),
): Promise<{
  torrentId: string
  sourceType: ResolvedTorrentRef['sourceType']
  resourceRef: string
  resourceRefExpiresAt: string
}> {
  const source = torrentSource(item)
  if (!source) throw new InvalidDownloadResourceRefError('The torrent has no downloadable source.')
  const expiresAt = new Date(now.getTime() + torrentRefLifetimeSeconds * 1000)
  const claims: TorrentRefClaims = {
    kind: 'torrent',
    userId,
    ...source,
    title: item.title,
    mediaKey,
    category: releaseCategory(mediaKey, item),
    tags: releaseTags(mediaKey, item),
  }
  const token = await new EncryptJWT({ ...claims })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ: 'zme-torrent-ref+jwt' })
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .encrypt(await encryptionKey(secret))
  return {
    torrentId: await torrentId(secret, userId, item, source.uri),
    sourceType: source.sourceType,
    resourceRef: `${torrentRefPrefix}${token}`,
    resourceRefExpiresAt: expiresAt.toISOString(),
  }
}

export async function resolveTorrentResourceRef(
  secret: string,
  userId: string,
  resourceRef: string,
): Promise<ResolvedTorrentRef> {
  if (!resourceRef.startsWith(torrentRefPrefix)) throw new InvalidDownloadResourceRefError()
  try {
    const { payload, protectedHeader } = await jwtDecrypt(
      resourceRef.slice(torrentRefPrefix.length),
      await encryptionKey(secret),
    )
    if (protectedHeader.typ !== 'zme-torrent-ref+jwt' || payload.kind !== 'torrent' || payload.userId !== userId) {
      throw new InvalidDownloadResourceRefError()
    }
    if (
      !['magnet', 'torrent_url'].includes(String(payload.sourceType)) ||
      typeof payload.uri !== 'string' ||
      typeof payload.title !== 'string' ||
      typeof payload.mediaKey !== 'string' ||
      typeof payload.category !== 'string' ||
      (payload.tags !== undefined &&
        (!Array.isArray(payload.tags) || !payload.tags.every((tag) => typeof tag === 'string')))
    ) {
      throw new InvalidDownloadResourceRefError()
    }
    return {
      kind: 'torrent',
      sourceType: payload.sourceType as ResolvedTorrentRef['sourceType'],
      uri: payload.uri,
      title: payload.title,
      mediaKey: payload.mediaKey,
      category: payload.category,
      tags: normalizeReleaseTags(payload.mediaKey, payload.tags),
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

function torrentSource(item: IndexerSearchItem) {
  if (item.magnetUrl) return { sourceType: 'magnet' as const, uri: item.magnetUrl }
  if (item.downloadUrl) return { sourceType: 'torrent_url' as const, uri: item.downloadUrl }
  return null
}

function releaseCategory(mediaKey: string, item: IndexerSearchItem): string {
  if (item.downloadTarget) return `zme:${item.downloadTarget}`
  if (mediaKey.startsWith('tmdb:tv:')) return 'zme:series'
  if (mediaKey.startsWith('tmdb:movie:')) return 'zme:movie'
  if (!mediaKey) return 'zme:other'
  throw new InvalidDownloadResourceRefError('The torrent media type is unsupported.')
}

function releaseTags(mediaKey: string, item: IndexerSearchItem): string[] {
  return normalizeReleaseTags(mediaKey, [
    item.imdbId ? `imdbId=${item.imdbId}` : null,
    item.tvdbId ? `tvdbId=${item.tvdbId}` : null,
  ])
}

function normalizeReleaseTags(mediaKey: string, tags: unknown): string[] {
  const tmdb = parseTmdbMediaKey(mediaKey)
  const externalIds = Array.isArray(tags)
    ? tags.filter(
        (tag): tag is string => typeof tag === 'string' && (tag.startsWith('imdbId=') || tag.startsWith('tvdbId=')),
      )
    : []
  return [
    ...new Set([tmdb ? `tmdbId=${tmdb.tmdbId}` : null, ...externalIds].filter((tag): tag is string => Boolean(tag))),
  ]
}

async function encryptionKey(secret: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)))
}

async function torrentId(secret: string, userId: string, item: IndexerSearchItem, sourceUri: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    await encryptionKey(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sourceIdentity =
    item.infoHash?.trim().toLowerCase() || getMagnetInfoHash(item.magnetUrl) || item.id || sourceUri
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${userId}\n${sourceIdentity}`))
  const value = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `torrent:${value}`
}

function getMagnetInfoHash(value: string | null): string | null {
  if (!value?.startsWith('magnet:')) return null
  try {
    return (
      new URL(value).searchParams
        .get('xt')
        ?.match(/^urn:btih:(.+)$/i)?.[1]
        ?.toLowerCase() ?? null
    )
  } catch {
    return null
  }
}
