import type { MediaSearchItem } from '@shared/types'

/** A media entry imported from an external library profile (e.g. Douban). */
export interface ImportedMediaEntry {
  title: string
  aliases: string[]
  year: string | null
}

const ACCEPTED_MATCH_SCORE = 4

export function chooseBestMatch(
  entry: ImportedMediaEntry,
  query: string,
  candidates: MediaSearchItem[],
): MediaSearchItem | null {
  let best: { item: MediaSearchItem; score: number } | null = null
  for (const item of candidates.slice(0, 8)) {
    const score = scoreCandidate(entry, query, item)
    if (!best || score > best.score) best = { item, score }
  }
  return best && best.score >= ACCEPTED_MATCH_SCORE ? best.item : null
}

function scoreCandidate(entry: ImportedMediaEntry, query: string, item: MediaSearchItem): number {
  const queryText = normalizeTitle(query)
  const sourceTitles = [entry.title, ...entry.aliases].map(normalizeTitle).filter(Boolean)
  const itemTitles = [item.title, item.originalTitle].map(normalizeTitle).filter(Boolean)
  let score = 0

  if (item.releaseYear && entry.year && item.releaseYear === entry.year) score += 2
  if (itemTitles.some((title) => title === queryText)) score += 4
  if (itemTitles.some((title) => sourceTitles.includes(title))) score += 4
  if (itemTitles.some((title) => title.includes(queryText) || queryText.includes(title))) score += 2
  if (item.rating && item.rating >= 5) score += 1

  return score
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[第\s]*(一|二|三|四|五|六|七|八|九|十|\d+)[季部]$/u, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '')
}
