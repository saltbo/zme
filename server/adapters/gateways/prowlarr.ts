import type { IndexerGateway, IndexerSearchInput } from '@server/usecases/ports'
import type { IndexerSearchItem } from '@shared/types'
import {
  applyProwlarrBaseUrl,
  isProwlarrProxyDownloadUrl,
  resolveProwlarrProxyDownloadUrl,
  stripProwlarrApiKey,
  withProwlarrApiKey,
} from './download-source'

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
  categories?: Array<{ id?: number | string; name?: string }>
  indexerFlags?: string[]
  imdbId?: number | string
  tmdbId?: number | string
  tvdbId?: number | string
}

export const prowlarrIndexerGateway: IndexerGateway = {
  async search(config, input) {
    const apiKey = config.credentials.apiKey
    if (!apiKey) throw new Error('Prowlarr API key is missing.')
    return searchProwlarr(config.endpoint, apiKey, input)
  },

  async probe(config) {
    const apiKey = config.credentials.apiKey
    if (!apiKey) throw new Error('Prowlarr API key is missing.')

    const response = await fetch(new URL('/api/v1/system/status', normalizeBaseUrl(config.endpoint)), {
      headers: {
        'X-Api-Key': apiKey,
        Accept: 'application/json',
      },
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Prowlarr request failed: ${response.status}${text ? ` ${text}` : ''}`)
    }
  },

  matchesDownloadUrl(config, uri) {
    return isProwlarrProxyDownloadUrl(uri) && getUrlHost(config.endpoint) === getUrlHost(uri)
  },

  async resolveDownloadSource(config, uri) {
    const apiKey = config.credentials.apiKey
    if (!apiKey) return null
    return resolveProwlarrProxyDownloadUrl(withProwlarrApiKey(uri, apiKey)).catch(() => null)
  },
}

export async function searchProwlarr(
  baseUrl: string,
  apiKey: string,
  input: IndexerSearchInput,
): Promise<IndexerSearchItem[]> {
  const url = new URL('/api/v1/search', normalizeBaseUrl(baseUrl))
  url.searchParams.set('query', input.query)
  url.searchParams.set('type', input.searchType ?? 'search')
  url.searchParams.set('indexerIds', '-2')
  for (const category of input.categories ?? []) {
    url.searchParams.append('categories', String(category))
  }

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
  return payload.map((item) => toIndexerSearchItem(item, normalizeBaseUrl(baseUrl)))
}

function toIndexerSearchItem(item: ProwlarrSearchItem, baseUrl: string): IndexerSearchItem {
  const resolved = resolveDownloadFields(item, baseUrl)
  const id = item.guid || item.infoHash || resolved.magnetUrl || resolved.downloadUrl || crypto.randomUUID()
  return {
    id,
    downloadTarget: null,
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
    categoryIds: item.categories?.flatMap((category) => parseCategoryId(category.id) ?? []) || [],
    indexerFlags: item.indexerFlags || [],
    imdbId: parsePositiveNumber(item.imdbId),
    tmdbId: parsePositiveNumber(item.tmdbId),
    tvdbId: parsePositiveNumber(item.tvdbId),
  }
}

function parseCategoryId(value: number | string | undefined): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function resolveDownloadFields(item: ProwlarrSearchItem, baseUrl: string) {
  if (item.magnetUrl?.startsWith('magnet:')) {
    return {
      downloadUrl: sanitizeDownloadUrl(item.downloadUrl),
      magnetUrl: item.magnetUrl,
    }
  }

  const proxyUrl = [item.magnetUrl, item.downloadUrl].find((value) => value && isProwlarrProxyDownloadUrl(value))
  if (proxyUrl) return { downloadUrl: stripProwlarrApiKey(applyProwlarrBaseUrl(proxyUrl, baseUrl)), magnetUrl: null }

  if (item.downloadUrl) {
    return {
      downloadUrl: item.downloadUrl,
      magnetUrl: null,
    }
  }

  return {
    downloadUrl: null,
    magnetUrl: null,
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

function getUrlHost(value: string) {
  try {
    return new URL(value).host
  } catch {
    return null
  }
}
