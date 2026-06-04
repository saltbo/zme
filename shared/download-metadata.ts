import type { MediaKind } from './types'

const zmeCategoryPrefix = 'zme:'

export function toZmeDownloadCategory(kind: MediaKind) {
  return `${zmeCategoryPrefix}${kind}`
}

export function normalizeZmeDownloadCategory(category: string | undefined) {
  if (category === 'movie' || category === 'tv') return toZmeDownloadCategory(category)
  return category
}

export function parseZmeDownloadCategory(category: string | null | undefined): MediaKind | null {
  if (!category?.startsWith(zmeCategoryPrefix)) return null
  const kind = category.slice(zmeCategoryPrefix.length)
  return kind === 'movie' || kind === 'tv' ? kind : null
}
