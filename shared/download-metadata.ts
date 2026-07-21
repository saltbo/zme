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

export function buildMusicDownloadSubdirectory(artists: string[], albumTitle: string | null): string {
  const artist = sanitizeDownloadPathComponent(artists[0] ?? '', 'Unknown Artist', 120)
  const album = sanitizeDownloadPathComponent(albumTitle ?? '', 'Unknown Album', 120)
  return `${artist}/${album}`
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
