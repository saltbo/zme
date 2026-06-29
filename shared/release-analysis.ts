import type { IndexerSearchItem } from './types'

export type ReleaseSourceTier = 'excellent' | 'good' | 'watchable' | 'poor' | 'unknown'
export type ReleaseResolutionId = '2160p' | '1080p' | '720p' | '480p' | '360p' | 'other'

export interface ReleaseSourceAnalysis {
  id: string
  label: string
  tier: ReleaseSourceTier
  score: number
}

export interface ReleaseResolutionAnalysis {
  id: ReleaseResolutionId
  label: string
  score: number
}

export interface IndexerReleaseAnalysis {
  source: ReleaseSourceAnalysis
  resolution: ReleaseResolutionAnalysis
  codec: string | null
  hdr: string | null
  audio: string | null
  subtitles: string[]
  editions: string[]
  warnings: Array<'lowQualitySource' | 'screenerSource'>
  score: number
}

interface SourcePattern {
  id: string
  label: string
  tier: ReleaseSourceTier
  score: number
  terms: string[]
}

const sourcePatterns: SourcePattern[] = [
  { id: 'screener', label: 'Screener', tier: 'watchable', score: 32, terms: ['DVDSCR', 'SCR', 'SCREENER'] },
  { id: 'r5', label: 'R5', tier: 'watchable', score: 28, terms: ['R5'] },
  { id: 'telecine', label: 'Telecine', tier: 'poor', score: 18, terms: ['TELECINE', 'TC'] },
  { id: 'telesync', label: 'Telesync', tier: 'poor', score: 14, terms: ['TELESYNC', 'HDTS', 'TS'] },
  { id: 'hdcam', label: 'HDCAM', tier: 'poor', score: 8, terms: ['HDCAM', 'HD CAM'] },
  { id: 'cam', label: 'CAM', tier: 'poor', score: 4, terms: ['CAMRIP', 'CAM RIP', 'CAM'] },
  { id: 'remux', label: 'REMUX', tier: 'excellent', score: 95, terms: ['REMUX', 'BDREMUX', 'BD REMUX'] },
  { id: 'bdmv', label: 'BDMV', tier: 'excellent', score: 92, terms: ['BDMV', 'BD25', 'BD50', 'BD66', 'BD100'] },
  { id: 'uhd-bluray', label: 'UHD BluRay', tier: 'excellent', score: 90, terms: ['UHD BLURAY', 'UHD BLU RAY'] },
  { id: 'bluray', label: 'BluRay', tier: 'good', score: 82, terms: ['BLURAY', 'BLU RAY', 'BDRIP', 'BRRIP'] },
  { id: 'dcprip', label: 'DCPRip', tier: 'good', score: 78, terms: ['DCPRIP', 'DCP RIP'] },
  { id: 'webdl', label: 'WEB-DL', tier: 'good', score: 74, terms: ['WEB DL', 'WEBDL', 'WEB'] },
  { id: 'webrip', label: 'WEBRip', tier: 'good', score: 68, terms: ['WEBRIP', 'WEB RIP'] },
  { id: 'hdtv', label: 'HDTV', tier: 'watchable', score: 54, terms: ['HDTV'] },
  { id: 'hdrip', label: 'HDRip', tier: 'watchable', score: 50, terms: ['HDRIP', 'HD RIP'] },
  { id: 'dvdrip', label: 'DVDRip', tier: 'watchable', score: 46, terms: ['DVDRIP', 'DVD RIP', 'DVD5', 'DVD9', 'DVD'] },
]

const unknownSource: ReleaseSourceAnalysis = {
  id: 'unknown',
  label: 'Unknown source',
  tier: 'unknown',
  score: 34,
}

const otherResolution: ReleaseResolutionAnalysis = {
  id: 'other',
  label: 'Other',
  score: 0,
}

export function analyzeIndexerRelease(item: IndexerSearchItem): IndexerReleaseAnalysis {
  const text = getReleaseText(item)
  const source = getReleaseSource(text)
  const resolution = getReleaseResolution(text)
  const codec = findFirstLabel(text, [
    ['AV1', ['AV1']],
    ['x265', ['X265', 'H265', 'H 265', 'HEVC']],
    ['x264', ['X264', 'H264', 'H 264', 'AVC']],
    ['VP9', ['VP9']],
    ['MPEG-2', ['MPEG2', 'MPEG 2']],
  ])
  const hdr = findFirstLabel(text, [
    ['Dolby Vision', ['DOLBY VISION', 'DOVI']],
    ['HDR10+', ['HDR10 PLUS', 'HDR10PLUS', 'HDR10+']],
    ['HDR10', ['HDR10']],
    ['HDR', ['HDR']],
    ['SDR', ['SDR']],
  ])
  const audio = findFirstLabel(text, [
    ['TrueHD Atmos', ['TRUEHD ATMOS']],
    ['Atmos', ['ATMOS']],
    ['DTS-HD MA', ['DTS HD MA', 'DTSHD MA', 'DTS HDMA', 'DTSHDMA']],
    ['DTS', ['DTS']],
    ['EAC3', ['EAC3', 'DDP7', 'DDP5', 'DDP2', 'DDP', 'DD+7', 'DD+5', 'DD+2', 'DD+', 'DD PLUS']],
    ['AC3', ['AC3', 'DD5 1', 'DD 5 1']],
    ['AAC', ['AAC7', 'AAC5', 'AAC2', 'AAC']],
    ['FLAC', ['FLAC']],
    ['MP3', ['MP3']],
  ])
  const subtitles = getLabels(text, [
    ['Hardcoded subs', ['HC', 'HARDSUB', 'HARDCODED']],
    ['CHS', ['CHS', 'GB', '简体']],
    ['CHT', ['CHT', 'BIG5', '繁体']],
    ['ENG subs', ['ENG SUB', 'ENGLISH SUB']],
    ['MULTi subs', ['MULTI SUB', 'MULTISUB']],
  ])
  const editions = getLabels(text, [
    ['IMAX', ['IMAX']],
    ['Extended', ['EXTENDED']],
    ["Director's Cut", ['DIRECTORS CUT', 'DIRECTOR S CUT']],
    ['Theatrical', ['THEATRICAL']],
    ['Unrated', ['UNRATED']],
    ['Criterion', ['CRITERION']],
  ])
  const warnings = getReleaseWarnings(source)

  return {
    source,
    resolution,
    codec,
    hdr,
    audio,
    subtitles,
    editions,
    warnings,
    score: getReleaseScore({ item, source, resolution, codec, hdr, audio, warnings }),
  }
}

export function compareIndexerReleasesByRecommendation(left: IndexerSearchItem, right: IndexerSearchItem): number {
  const leftAnalysis = analyzeIndexerRelease(left)
  const rightAnalysis = analyzeIndexerRelease(right)
  return (
    rightAnalysis.score - leftAnalysis.score ||
    (right.seeders ?? 0) - (left.seeders ?? 0) ||
    getTime(right.publishDate) - getTime(left.publishDate) ||
    (right.size ?? 0) - (left.size ?? 0)
  )
}

function getReleaseText(item: IndexerSearchItem) {
  return normalizeReleaseMarkerText(
    [item.title, item.fileName, item.categories.join(' '), item.indexerFlags.join(' ')].filter(Boolean).join(' '),
  )
}

function getReleaseSource(text: string): ReleaseSourceAnalysis {
  const source = sourcePatterns.find((pattern) => pattern.terms.some((term) => hasTerm(text, term)))
  return source ? { id: source.id, label: source.label, tier: source.tier, score: source.score } : unknownSource
}

function getReleaseResolution(text: string): ReleaseResolutionAnalysis {
  if (hasTerm(text, '2160P') || hasTerm(text, '4K')) {
    return { id: '2160p', label: '2160p / 4K', score: 24 }
  }
  if (hasTerm(text, '1080P')) return { id: '1080p', label: '1080p', score: 18 }
  if (hasTerm(text, '720P')) return { id: '720p', label: '720p', score: 10 }
  if (hasTerm(text, '480P')) return { id: '480p', label: '480p', score: 3 }
  if (hasTerm(text, '360P')) return { id: '360p', label: '360p', score: 1 }
  if (hasTerm(text, 'UHD')) return { id: '2160p', label: '2160p / 4K', score: 24 }
  return otherResolution
}

function getReleaseWarnings(source: ReleaseSourceAnalysis): IndexerReleaseAnalysis['warnings'] {
  if (source.tier === 'poor') return ['lowQualitySource']
  if (source.id === 'screener') return ['screenerSource']
  return []
}

function getReleaseScore({
  item,
  source,
  resolution,
  codec,
  hdr,
  audio,
  warnings,
}: {
  item: IndexerSearchItem
  source: ReleaseSourceAnalysis
  resolution: ReleaseResolutionAnalysis
  codec: string | null
  hdr: string | null
  audio: string | null
  warnings: IndexerReleaseAnalysis['warnings']
}) {
  const seedScore = Math.min(Math.log10((item.seeders ?? 0) + 1) * 12, 32)
  const metadataScore = [item.imdbId, item.tmdbId, item.tvdbId].some(Boolean) ? 8 : 0
  const sourceUrlScore = item.magnetUrl || item.downloadUrl ? 3 : 0
  const codecScore = codec ? 4 : 0
  const hdrScore = hdr && hdr !== 'SDR' ? 3 : 0
  const audioScore = audio ? 3 : 0
  const warningPenalty = warnings.length * 55

  return (
    source.score +
    resolution.score +
    seedScore +
    metadataScore +
    sourceUrlScore +
    codecScore +
    hdrScore +
    audioScore -
    warningPenalty
  )
}

function findFirstLabel(text: string, patterns: Array<[string, string[]]>) {
  return patterns.find(([, terms]) => terms.some((term) => hasTerm(text, term)))?.[0] ?? null
}

function getLabels(text: string, patterns: Array<[string, string[]]>) {
  return patterns.flatMap(([label, terms]) => (terms.some((term) => hasTerm(text, term)) ? [label] : []))
}

function hasTerm(text: string, term: string) {
  const normalized = normalizeReleaseMarkerText(term)
  if (!normalized) return false
  return new RegExp(`(?:^|\\s)${escapeRegExp(normalized)}(?:\\s|$)`).test(text)
}

function normalizeReleaseMarkerText(value: string) {
  return value
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[''']/g, ' ')
    .replace(/[^A-Z0-9\u4e00-\u9fff+]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getTime(value: string | null) {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}
