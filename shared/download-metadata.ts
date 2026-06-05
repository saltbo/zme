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
