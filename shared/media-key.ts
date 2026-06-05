import type { LibraryKind, MediaKind } from './types'

const MUSICBRAINZ_MBID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface MediaKeyParts {
  provider: string
  resourceType: string
  id: string
}

export function buildMediaKey(parts: MediaKeyParts): string {
  return `${parts.provider}:${parts.resourceType}:${parts.id}`
}

export function parseMediaKey(value: string): MediaKeyParts | null {
  const [provider, resourceType, id, extra] = value.split(':')
  if (!provider || !resourceType || !id || extra !== undefined) return null
  return { provider, resourceType, id }
}

export function buildTmdbMediaKey(kind: MediaKind, tmdbId: number): string {
  return buildMediaKey({ provider: 'tmdb', resourceType: kind, id: String(tmdbId) })
}

export function buildMusicBrainzMediaKey(
  resourceType: 'release-group' | 'release' | 'recording',
  mbid: string,
): string {
  return buildMediaKey({ provider: 'musicbrainz', resourceType, id: mbid })
}

export function parseMusicBrainzMediaKey(
  value: string,
): { resourceType: 'release-group' | 'release' | 'recording'; mbid: string } | null {
  const parts = parseMediaKey(value)
  if (parts?.provider !== 'musicbrainz') return null
  if (
    parts.resourceType !== 'release-group' &&
    parts.resourceType !== 'release' &&
    parts.resourceType !== 'recording'
  ) {
    return null
  }
  if (!MUSICBRAINZ_MBID_PATTERN.test(parts.id)) return null

  return { resourceType: parts.resourceType, mbid: parts.id }
}

export function parseTmdbMediaKey(value: string): { kind: MediaKind; tmdbId: number } | null {
  const parts = parseMediaKey(value)
  if (parts?.provider !== 'tmdb') return null
  if (parts.resourceType !== 'movie' && parts.resourceType !== 'tv') return null

  const tmdbId = Number(parts.id)
  if (!Number.isInteger(tmdbId) || tmdbId <= 0 || String(tmdbId) !== parts.id) return null

  return { kind: parts.resourceType, tmdbId }
}

export function getMediaKeyLibraryKind(value: string): LibraryKind | null {
  const parts = parseMediaKey(value)
  if (!parts) return null

  if (parts.provider === 'tmdb' && (parts.resourceType === 'movie' || parts.resourceType === 'tv')) {
    return parts.resourceType
  }

  const musicBrainz = parseMusicBrainzMediaKey(value)
  if (musicBrainz?.resourceType === 'release-group' || musicBrainz?.resourceType === 'release') {
    return 'music'
  }
  if (parts.provider === 'isbn' && parts.resourceType === 'book') return 'book'
  if (parts.provider === 'openlibrary' && (parts.resourceType === 'work' || parts.resourceType === 'edition')) {
    return 'book'
  }

  return null
}
