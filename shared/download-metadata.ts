import type { MediaKind } from './types'

const zmeCategoryPrefix = 'zme:'

export function toZmeDownloadCategory(kind: MediaKind) {
  return `${zmeCategoryPrefix}${kind === 'tv' ? 'series' : kind}`
}

export function normalizeZmeDownloadCategory(category: string | undefined) {
  if (category === 'movie' || category === 'tv') return toZmeDownloadCategory(category)
  return category
}

export function parseZmeDownloadCategory(category: string | null | undefined): MediaKind | null {
  if (!category?.startsWith(zmeCategoryPrefix)) return null
  const kind = category.slice(zmeCategoryPrefix.length)
  if (kind === 'series') return 'tv'
  return kind === 'movie' || kind === 'tv' ? kind : null
}

export type ZmeDownloadResourceType = 'movie' | 'tv' | 'music' | 'ebook' | 'audiobook'

const zmeDownloadResourceDirectories: Record<ZmeDownloadResourceType, string> = {
  movie: 'Movies',
  tv: 'Series',
  music: 'Music',
  ebook: 'Ebooks',
  audiobook: 'Audiobooks',
}

export function parseZmeDownloadResourceType(category: string | null | undefined): ZmeDownloadResourceType | null {
  const normalized = normalizeZmeDownloadCategory(category ?? undefined)
  if (!normalized?.startsWith(zmeCategoryPrefix)) return null

  const value = normalized.slice(zmeCategoryPrefix.length)
  if (value === 'series') return 'tv'
  if (value === 'movie' || value === 'tv' || value === 'music' || value === 'ebook' || value === 'audiobook') {
    return value
  }
  if (value === 'book:ebook') return 'ebook'
  if (value === 'book:audiobook') return 'audiobook'
  return null
}

export function getZmeDownloadResourceDirectory(category: string | null | undefined): string | null {
  const resourceType = parseZmeDownloadResourceType(category)
  return resourceType ? zmeDownloadResourceDirectories[resourceType] : null
}

export function isValidDownloadSubdirectory(value: string): boolean {
  if (!value || value.length > 500 || value.startsWith('/') || value.endsWith('/')) return false
  return value.split('/').every((component) => {
    if (!component || component === '.' || component === '..' || component.length > 120) return false
    if (component !== component.trim() || component.endsWith('.')) return false
    if (/[\\:*?"<>|]/.test(component)) return false
    return [...component].every((character) => character.charCodeAt(0) >= 32)
  })
}

export interface MusicDownloadMetadata {
  title: string
  artists: string[]
  albumTitle: string | null
  albumArtists: string[]
  albumReleaseDate: string | null
  discNumber: number | null
  trackNumber: number | null
}

export function buildMusicDownloadSubdirectory(metadata: MusicDownloadMetadata): string {
  const artistCredit = metadata.albumArtists.length > 0 ? metadata.albumArtists : metadata.artists
  const artist = sanitizeDownloadPathComponent(artistCredit.join(', '), 'Unknown Artist', 120)
  const albumTitle = sanitizeDownloadPathComponent(metadata.albumTitle ?? '', 'Unknown Album', 100)
  const year = releaseYear(metadata.albumReleaseDate)
  const album = year && !albumTitle.endsWith(`(${year})`) ? `${albumTitle} (${year})` : albumTitle
  return `${artist}/${album}`
}

export function buildMusicDownloadFilename(metadata: MusicDownloadMetadata, extension: string): string {
  const position = trackPosition(metadata.discNumber, metadata.trackNumber)
  const trackArtist = metadata.artists.join(', ')
  const albumArtist = metadata.albumArtists.join(', ')
  const artistPrefix = trackArtist && albumArtist && trackArtist !== albumArtist ? `${trackArtist} - ` : ''
  const fallback = trackArtist ? `${trackArtist} - ${metadata.title}` : metadata.title
  const basename = sanitizeDownloadPathComponent(
    position ? `${position} ${artistPrefix}${metadata.title}` : fallback,
    'track',
    180,
  )
  const safeExtension = sanitizeDownloadPathComponent(extension.toLowerCase(), 'mp3', 10)
  return `${basename}.${safeExtension}`
}

function releaseYear(value: string | null): string | null {
  const match = value?.match(/^(\d{4})/)
  return match?.[1] ?? null
}

function trackPosition(discNumber: number | null, trackNumber: number | null): string | null {
  if (!trackNumber || trackNumber < 1) return null
  const disc = discNumber && discNumber > 0 ? discNumber : 1
  return `${String(disc).padStart(2, '0')}-${String(trackNumber).padStart(2, '0')}`
}

export function sanitizeDownloadPathComponent(value: string, fallback: string, maxLength: number): string {
  const normalized = [...value.replace(/[\\/:*?"<>|]/g, '_')]
    .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .join('')
    .trim()
  const sanitized = [...normalized]
    .slice(0, maxLength)
    .join('')
    .replace(/[. ]+$/, '')
  return sanitized || fallback
}
