import { parseZmeDownloadResourceType } from '@shared/download-metadata'
import { parseTmdbMediaKey } from '@shared/media-key'
import type { DownloadSummary } from '@shared/types'

export type DownloadCatalogResource = { kind: 'music' | 'book'; mediaKey: string }

export function getDownloadMedia(download: Pick<DownloadSummary, 'resourceKey'>) {
  return parseTmdbMediaKey(download.resourceKey)
}

export function getDownloadCatalogResource(
  download: Pick<DownloadSummary, 'category' | 'resourceKey'>,
): DownloadCatalogResource | null {
  const resourceType = parseZmeDownloadResourceType(download.category)
  if (resourceType === 'music') return { kind: 'music', mediaKey: download.resourceKey }
  if (resourceType === 'ebook' || resourceType === 'audiobook') {
    return { kind: 'book', mediaKey: download.resourceKey }
  }
  return null
}
