import type { IndexerSearchItem } from '@shared/types'
import { isProwlarrProxyDownloadUrl, resolveProwlarrProxyDownloadUrl } from './download-source'

interface ProwlarrSearchItem {
  guid?: string
  title?: string
  fileName?: string
  indexer?: string
  size?: number
  seeders?: number
  leechers?: number
  files?: number
  protocol?: string
  publishDate?: string
  downloadUrl?: string
  magnetUrl?: string
  infoUrl?: string
  infoHash?: string
  categories?: Array<{ name?: string }>
  indexerFlags?: string[]
  imdbId?: number | string
  tmdbId?: number | string
  tvdbId?: number | string
}

export interface ProwlarrSearchInput {
  query: string
  title?: string
  year?: string
  aliases?: string[]
  kind?: 'movie' | 'tv'
  imdbId?: string
  tmdbId?: number
  tvdbId?: number
}

export async function searchProwlarr(
  baseUrl: string,
  apiKey: string,
  input: ProwlarrSearchInput,
): Promise<IndexerSearchItem[]> {
  const url = new URL('/api/v1/search', normalizeBaseUrl(baseUrl))
  url.searchParams.set('query', input.query)
  url.searchParams.set('type', 'search')
  url.searchParams.set('indexerIds', '-2')

  const response = await fetch(url, {
    headers: {
      'X-Api-Key': apiKey,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Prowlarr search failed: ${response.status}`)
  }

  const payload = (await response.json()) as ProwlarrSearchItem[]
  return Promise.all(payload.map(toIndexerSearchItem))
}

async function toIndexerSearchItem(item: ProwlarrSearchItem): Promise<IndexerSearchItem> {
  const resolved = await resolveDownloadFields(item)
  const id = item.guid || item.infoHash || resolved.magnetUrl || resolved.downloadUrl || crypto.randomUUID()
  return {
    id,
    title: item.title || 'Untitled release',
    fileName: item.fileName || null,
    indexer: item.indexer || 'Unknown',
    size: typeof item.size === 'number' ? item.size : null,
    seeders: typeof item.seeders === 'number' ? item.seeders : null,
    leechers: typeof item.leechers === 'number' ? item.leechers : null,
    files: typeof item.files === 'number' ? item.files : null,
    protocol: item.protocol || null,
    publishDate: item.publishDate || null,
    downloadUrl: resolved.downloadUrl,
    magnetUrl: resolved.magnetUrl,
    infoUrl: item.infoUrl || null,
    infoHash: item.infoHash || null,
    categories: item.categories?.flatMap((category) => (category.name ? [category.name] : [])) || [],
    indexerFlags: item.indexerFlags || [],
    imdbId: parsePositiveNumber(item.imdbId),
    tmdbId: parsePositiveNumber(item.tmdbId),
    tvdbId: parsePositiveNumber(item.tvdbId),
  }
}

async function resolveDownloadFields(item: ProwlarrSearchItem) {
  if (item.magnetUrl) {
    return {
      downloadUrl: sanitizeDownloadUrl(item.downloadUrl),
      magnetUrl: item.magnetUrl,
    }
  }

  if (!item.downloadUrl) {
    return {
      downloadUrl: null,
      magnetUrl: null,
    }
  }

  if (!isProwlarrProxyDownloadUrl(item.downloadUrl)) {
    return {
      downloadUrl: item.downloadUrl,
      magnetUrl: null,
    }
  }

  const resolved = await resolveProwlarrProxyDownloadUrl(item.downloadUrl)
  return {
    downloadUrl: resolved?.sourceType === 'torrent_url' ? resolved.uri : null,
    magnetUrl: resolved?.sourceType === 'magnet' ? resolved.uri : null,
  }
}

function sanitizeDownloadUrl(value: string | undefined): string | null {
  if (!value) return null
  return isProwlarrProxyDownloadUrl(value) ? null : value
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

function parsePositiveNumber(value: number | string | undefined): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0 ? parsed : null
}
