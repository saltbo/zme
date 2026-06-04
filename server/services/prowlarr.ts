import type { IndexerSearchItem } from '@shared/types'

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
  imdbId?: number
  tmdbId?: number
}

export async function searchIndexers(baseUrl: string, apiKey: string, query: string): Promise<IndexerSearchItem[]> {
  const url = new URL('/api/v1/search', normalizeBaseUrl(baseUrl))
  url.searchParams.set('query', query)
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
  return payload.map(toIndexerSearchItem)
}

function toIndexerSearchItem(item: ProwlarrSearchItem): IndexerSearchItem {
  const id = item.guid || item.downloadUrl || item.magnetUrl || crypto.randomUUID()
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
    downloadUrl: item.downloadUrl || null,
    magnetUrl: item.magnetUrl || null,
    infoUrl: item.infoUrl || null,
    infoHash: item.infoHash || null,
    categories: item.categories?.flatMap((category) => (category.name ? [category.name] : [])) || [],
    indexerFlags: item.indexerFlags || [],
    imdbId: typeof item.imdbId === 'number' && item.imdbId > 0 ? item.imdbId : null,
    tmdbId: typeof item.tmdbId === 'number' && item.tmdbId > 0 ? item.tmdbId : null,
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}
