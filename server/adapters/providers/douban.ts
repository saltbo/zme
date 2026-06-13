import type { LibraryEntryImporter } from '@server/usecases/ports'

export type DoubanMediaStatus = 'wish' | 'collect'

export interface DoubanMediaEntry {
  sourceId: string
  status: DoubanMediaStatus
  title: string
  aliases: string[]
  year: string | null
  markedAt: string | null
}

const DOUBAN_MOVIE_BASE = 'https://movie.douban.com'
const PAGE_SIZE = 15
const MAX_PAGES_PER_STATUS = 200

export async function fetchDoubanProfileEntries(profileId: string): Promise<DoubanMediaEntry[]> {
  const entries: DoubanMediaEntry[] = []
  for (const status of ['wish', 'collect'] as const) {
    entries.push(...(await fetchDoubanStatusEntries(profileId, status)))
  }
  return dedupeEntries(entries)
}

async function fetchDoubanStatusEntries(profileId: string, status: DoubanMediaStatus): Promise<DoubanMediaEntry[]> {
  const entries: DoubanMediaEntry[] = []
  for (let page = 0; page < MAX_PAGES_PER_STATUS; page += 1) {
    const start = page * PAGE_SIZE
    const html = await fetchDoubanPage(profileId, status, start)
    const pageEntries = parseDoubanEntries(html, status)
    entries.push(...pageEntries)
    if (pageEntries.length === 0) break
  }
  return entries
}

async function fetchDoubanPage(profileId: string, status: DoubanMediaStatus, start: number): Promise<string> {
  const url = new URL(`${DOUBAN_MOVIE_BASE}/people/${encodeURIComponent(profileId)}/${status}`)
  url.searchParams.set('start', String(start))
  url.searchParams.set('sort', 'time')
  url.searchParams.set('rating', 'all')
  url.searchParams.set('filter', 'all')
  url.searchParams.set('mode', 'grid')

  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    },
  })

  if (!response.ok) {
    throw new Error(`Douban request failed: ${response.status}`)
  }

  return response.text()
}

export function parseDoubanEntries(html: string, status: DoubanMediaStatus): DoubanMediaEntry[] {
  const grid = html.match(/<div class="grid-view">([\s\S]*?)<\/div>\s*<\/div>\s*<div class="aside">/)?.[1] ?? ''
  if (!grid) return []

  return grid
    .split(/<div class="item comment-item"[^>]*>/)
    .slice(1)
    .map((block) => parseDoubanEntry(block, status))
    .filter((entry): entry is DoubanMediaEntry => entry !== null)
}

function parseDoubanEntry(block: string, status: DoubanMediaStatus): DoubanMediaEntry | null {
  const sourceId = block.match(/movie\.douban\.com\/subject\/(\d+)\//)?.[1]
  const emTitle = stripTags(block.match(/<li class="title">[\s\S]*?<em>([\s\S]*?)<\/em>/)?.[1] ?? '')
  const titleAttr = decodeHtml(
    block.match(/<a title="([^"]+)" href="https:\/\/movie\.douban\.com\/subject\/\d+\/" class="nbg">/)?.[1] ?? '',
  )
  const intro = stripTags(block.match(/<li class="intro">([\s\S]*?)<\/li>/)?.[1] ?? '')
  const markedAt = block.match(/<span class="date">([^<]+)<\/span>/)?.[1]?.trim() ?? null
  const year = findYear(intro) ?? findYear(emTitle)
  const titleParts = emTitle
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
  const title = titleParts[0] || titleAttr

  if (!sourceId || !title) return null

  const aliases = uniqueStrings([titleAttr, ...titleParts].filter((value) => value && value !== title))

  return {
    sourceId,
    status,
    title,
    aliases,
    year,
    markedAt: markedAt ? `${markedAt}T00:00:00.000Z` : null,
  }
}

function findYear(value: string): string | null {
  return value.match(/\b(19|20)\d{2}\b/)?.[0] ?? null
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .trim()
}

function dedupeEntries(entries: DoubanMediaEntry[]): DoubanMediaEntry[] {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    const key = `${entry.status}:${entry.sourceId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

export const doubanLibraryImporter: LibraryEntryImporter = {
  fetchEntries: (profileId) => fetchDoubanProfileEntries(profileId),
}
