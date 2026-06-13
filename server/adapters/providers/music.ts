import { type MusicProvider, MusicProviderError } from '@server/usecases/ports'
import { buildMusicBrainzMediaKey, parseMusicBrainzMediaKey } from '@shared/media-key'
import type {
  MusicAlbumDetails,
  MusicAlbumSearchItem,
  MusicAlias,
  MusicArtistCredit,
  MusicCoverArt,
  MusicDiscoveryInput,
  MusicMedium,
  MusicReleaseSummary,
  MusicTrack,
  ResourcePage,
} from '@shared/types'

interface MusicBrainzSearchResponse {
  'release-groups'?: MusicBrainzReleaseGroup[]
}

interface MusicBrainzReleaseGroup {
  id?: string
  title?: string
  disambiguation?: string
  'first-release-date'?: string
  'primary-type'?: string
  'secondary-types'?: string[]
  'artist-credit'?: MusicBrainzArtistCredit[]
  releases?: MusicBrainzRelease[]
  aliases?: MusicBrainzAlias[]
}

interface MusicBrainzRelease {
  id?: string
  title?: string
  date?: string
  country?: string
  status?: string
  barcode?: string
  disambiguation?: string
  'artist-credit'?: MusicBrainzArtistCredit[]
  'release-group'?: MusicBrainzReleaseGroup
  media?: MusicBrainzMedium[]
  aliases?: MusicBrainzAlias[]
}

interface MusicBrainzArtistCredit {
  name?: string
  joinphrase?: string
  artist?: {
    id?: string
    name?: string
    aliases?: MusicBrainzAlias[]
  }
}

interface MusicBrainzAlias {
  name?: string
  locale?: string | null
  primary?: boolean | string
  type?: string | null
}

interface MusicBrainzMedium {
  position?: number
  format?: string
  title?: string
  'track-count'?: number
  tracks?: MusicBrainzTrack[]
}

interface MusicBrainzTrack {
  position?: number
  number?: string
  title?: string
  length?: number
  recording?: {
    id?: string
    title?: string
    isrcs?: string[]
  }
}

interface CoverArtArchiveResponse {
  images?: CoverArtArchiveImage[]
}

interface CoverArtArchiveImage {
  image?: string
  front?: boolean
  back?: boolean
  thumbnails?: Record<string, string | undefined>
}

interface ListenBrainzTopReleasesResponse {
  payload?: {
    releases?: ListenBrainzTopRelease[]
  }
}

interface ListenBrainzTopRecordingsResponse {
  payload?: {
    recordings?: ListenBrainzTopRecording[]
  }
}

interface ListenBrainzTopRelease {
  release_mbid?: string
  release_name?: string
  artist_name?: string
  artist_mbids?: string[]
  caa_id?: number
  caa_release_mbid?: string
  listen_count?: number
}

interface ListenBrainzTopRecording {
  recording_mbid?: string
  recording_name?: string
  track_name?: string
  artist_name?: string
  artist_mbids?: string[]
  caa_id?: number
  caa_release_mbid?: string
  listen_count?: number
}

const MUSICBRAINZ_API_BASE = 'https://musicbrainz.org/ws/2'
const LISTENBRAINZ_API_BASE = 'https://api.listenbrainz.org/1'
const COVER_ART_ARCHIVE_BASE = 'https://coverartarchive.org'
const MUSICBRAINZ_USER_AGENT = 'curarr/0.0.1 (https://github.com/saltbo/zme)'
const MUSICBRAINZ_REQUEST_INTERVAL_MS = 1000
const MBID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let nextMusicBrainzRequestAt = 0
let musicBrainzQueue = Promise.resolve()

export async function searchMusicAlbums(input: {
  q?: string
  query?: string
  artist?: string
  title?: string
  tag?: string
  releaseType?: string
  year?: string
  limit?: number
  page?: number
}): Promise<ResourcePage<MusicAlbumSearchItem>> {
  const page = input.page ?? 1
  const pageSize = input.limit ?? 20
  const url = new URL(`${MUSICBRAINZ_API_BASE}/release-group`)
  url.searchParams.set('fmt', 'json')
  url.searchParams.set('inc', 'artist-credits+releases')
  url.searchParams.set('limit', String(pageSize))
  url.searchParams.set('offset', String((page - 1) * pageSize))
  url.searchParams.set('query', buildReleaseGroupSearchQuery(input))

  const payload = (await fetchMusicBrainzJson(url)) as MusicBrainzSearchResponse
  const results = (await Promise.all((payload['release-groups'] ?? []).map(toMusicAlbumSearchItemWithCover))).filter(
    (item): item is MusicAlbumSearchItem => item !== null,
  )
  return toResourcePage(results, page, pageSize)
}

async function toMusicAlbumSearchItemWithCover(
  releaseGroup: MusicBrainzReleaseGroup,
): Promise<MusicAlbumSearchItem | null> {
  const coverArt = await getReleaseGroupSearchCoverArt(releaseGroup)
  return toMusicAlbumSearchItem(releaseGroup, coverArt)
}

async function getReleaseGroupSearchCoverArt(releaseGroup: MusicBrainzReleaseGroup): Promise<MusicCoverArt> {
  const preferredRelease = selectPreferredRelease(releaseGroup.releases ?? [])
  const [releaseCoverArt, releaseGroupCoverArt] = await Promise.all([
    getCoverArtOrEmpty('release', preferredRelease?.id ?? ''),
    getCoverArtOrEmpty('release-group', releaseGroup.id ?? ''),
  ])
  return mergeCoverArt(releaseCoverArt, releaseGroupCoverArt)
}

async function getCoverArtOrEmpty(kind: 'release' | 'release-group', mbid: string): Promise<MusicCoverArt> {
  try {
    return await getCoverArt(kind, mbid)
  } catch (error) {
    if (error instanceof MusicProviderError && error.code === 'COVER_ART_ARCHIVE_REQUEST_FAILED') {
      return emptyCoverArt()
    }
    throw error
  }
}

export async function discoverMusicAlbums(input: MusicDiscoveryInput): Promise<ResourcePage<MusicAlbumSearchItem>> {
  if (input.mode === 'genre') {
    return searchMusicAlbums({
      tag: input.genre,
      releaseType: input.releaseType,
      year: input.year,
      page: input.page,
      limit: input.pageSize,
    })
  }

  const url = new URL(
    `${LISTENBRAINZ_API_BASE}/stats/sitewide/${input.chartType === 'tracks' ? 'recordings' : 'releases'}`,
  )
  url.searchParams.set('count', String(input.pageSize))
  url.searchParams.set('offset', String((input.page - 1) * input.pageSize))
  url.searchParams.set('range', input.range)

  if (input.chartType === 'tracks') {
    const payload = (await fetchListenBrainzJson(url)) as ListenBrainzTopRecordingsResponse
    if (payload.payload?.recordings !== undefined && !Array.isArray(payload.payload.recordings)) {
      throw new MusicProviderError(
        'ListenBrainz top recordings response has invalid recordings.',
        502,
        'LISTENBRAINZ_FAILED',
      )
    }
    const results = (payload.payload?.recordings ?? [])
      .map(toPopularMusicRecordingSearchItem)
      .filter((item): item is MusicAlbumSearchItem => item !== null)
    return toResourcePage(results, input.page, input.pageSize)
  }

  const payload = (await fetchListenBrainzJson(url)) as ListenBrainzTopReleasesResponse
  if (payload.payload?.releases !== undefined && !Array.isArray(payload.payload.releases)) {
    throw new MusicProviderError('ListenBrainz top releases response has invalid releases.', 502, 'LISTENBRAINZ_FAILED')
  }
  const results = (payload.payload?.releases ?? [])
    .map(toPopularMusicAlbumSearchItem)
    .filter((item): item is MusicAlbumSearchItem => item !== null)
  return toResourcePage(results, input.page, input.pageSize)
}

export async function getMusicAlbumDetails(mediaKey: string): Promise<MusicAlbumDetails> {
  const parts = parseMusicBrainzAlbumMediaKey(mediaKey)
  if (!parts) {
    throw new MusicProviderError('Unsupported music media key.', 400, 'INVALID_MUSIC_MEDIA_KEY')
  }

  if (parts.resourceType === 'release') {
    const release = await lookupRelease(parts.id)
    return detailsFromRelease(mediaKey, release)
  }

  const releaseGroup = await lookupReleaseGroup(parts.id)
  const preferredRelease = selectPreferredRelease(releaseGroup.releases ?? [])
  if (!preferredRelease?.id) {
    throw new MusicProviderError('MusicBrainz release group has no release details.', 502, 'MUSIC_PROVIDER_FAILED')
  }

  const release = await lookupRelease(preferredRelease.id)
  return detailsFromRelease(mediaKey, release, releaseGroup)
}

async function lookupReleaseGroup(mbid: string): Promise<MusicBrainzReleaseGroup> {
  const url = new URL(`${MUSICBRAINZ_API_BASE}/release-group/${mbid}`)
  url.searchParams.set('fmt', 'json')
  url.searchParams.set('inc', 'artist-credits+releases')

  const payload = (await fetchMusicBrainzJson(url)) as MusicBrainzReleaseGroup
  if (!payload.id || !payload.title) {
    throw new MusicProviderError(
      'MusicBrainz release group response is missing required fields.',
      502,
      'MUSIC_PROVIDER_FAILED',
    )
  }
  return payload
}

async function lookupRelease(mbid: string): Promise<MusicBrainzRelease> {
  const url = new URL(`${MUSICBRAINZ_API_BASE}/release/${mbid}`)
  url.searchParams.set('fmt', 'json')
  url.searchParams.set('inc', 'artist-credits+release-groups+media+recordings+isrcs+aliases')

  const payload = (await fetchMusicBrainzJson(url)) as MusicBrainzRelease
  if (!payload.id || !payload.title) {
    throw new MusicProviderError(
      'MusicBrainz release response is missing required fields.',
      502,
      'MUSIC_PROVIDER_FAILED',
    )
  }
  return payload
}

async function detailsFromRelease(
  detailMediaKey: string,
  release: MusicBrainzRelease,
  releaseGroupOverride?: MusicBrainzReleaseGroup,
): Promise<MusicAlbumDetails> {
  const releaseGroup = releaseGroupOverride ?? release['release-group']
  if (!releaseGroup?.id || !releaseGroup.title) {
    throw new MusicProviderError(
      'MusicBrainz release response is missing release group fields.',
      502,
      'MUSIC_PROVIDER_FAILED',
    )
  }

  const [releaseCoverArt, releaseGroupCoverArt] = await Promise.all([
    getCoverArt('release', release.id ?? ''),
    getCoverArt('release-group', releaseGroup.id),
  ])
  const searchItem = toMusicAlbumSearchItem(releaseGroup, releaseGroupCoverArt)
  if (!searchItem) {
    throw new MusicProviderError(
      'MusicBrainz release group response is missing required fields.',
      502,
      'MUSIC_PROVIDER_FAILED',
    )
  }

  const releases = releaseGroupOverride?.releases ?? [release]
  const media = toMusicMedia(release.media ?? [])
  const formats = [...new Set(media.map((item) => item.format).filter((format): format is string => Boolean(format)))]

  return {
    ...searchItem,
    detailMediaKey,
    releaseMbid: release.id ?? null,
    preferredRelease: toMusicReleaseSummary(release),
    releases: releases
      .map(toMusicReleaseSummary)
      .filter((item): item is MusicReleaseSummary => item !== null)
      .sort(compareReleaseSummaries),
    releaseDate: release.date || null,
    country: release.country || null,
    barcode: release.barcode || null,
    aliases: toMusicAliases([
      ...(releaseGroup.aliases ?? []),
      ...(release.aliases ?? []),
      ...getArtistAliases(release),
    ]),
    coverArt: mergeCoverArt(releaseCoverArt, releaseGroupCoverArt),
    formats,
    media,
  }
}

async function fetchMusicBrainzJson(url: URL): Promise<unknown> {
  return enqueueMusicBrainzRequest(async () => {
    let response: Response
    try {
      response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': MUSICBRAINZ_USER_AGENT,
        },
      })
    } catch (error) {
      throw new MusicProviderError(
        error instanceof Error ? `MusicBrainz request failed: ${error.message}` : 'MusicBrainz request failed.',
        502,
        'MUSICBRAINZ_REQUEST_FAILED',
      )
    }

    if (response.status === 404) {
      throw new MusicProviderError('MusicBrainz resource not found.', 404, 'MUSIC_NOT_FOUND')
    }
    if (!response.ok) {
      const status = response.status === 429 ? 429 : 502
      throw new MusicProviderError(
        `MusicBrainz request failed: ${response.status}`,
        status,
        'MUSICBRAINZ_REQUEST_FAILED',
      )
    }

    return response.json()
  })
}

async function fetchListenBrainzJson(url: URL): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': MUSICBRAINZ_USER_AGENT,
      },
    })
  } catch (error) {
    throw new MusicProviderError(
      error instanceof Error ? `ListenBrainz request failed: ${error.message}` : 'ListenBrainz request failed.',
      502,
      'LISTENBRAINZ_REQUEST_FAILED',
    )
  }

  if (!response.ok) {
    const status = response.status === 429 ? 429 : 502
    throw new MusicProviderError(
      `ListenBrainz request failed: ${response.status}`,
      status,
      'LISTENBRAINZ_REQUEST_FAILED',
    )
  }

  try {
    return await response.json()
  } catch (error) {
    throw new MusicProviderError(
      error instanceof Error
        ? `ListenBrainz returned invalid JSON: ${error.message}`
        : 'ListenBrainz returned invalid JSON.',
      502,
      'LISTENBRAINZ_REQUEST_FAILED',
    )
  }
}

async function enqueueMusicBrainzRequest<T>(request: () => Promise<T>): Promise<T> {
  const run = musicBrainzQueue.then(async () => {
    const now = Date.now()
    const delay = Math.max(0, nextMusicBrainzRequestAt - now)
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    nextMusicBrainzRequestAt = Date.now() + MUSICBRAINZ_REQUEST_INTERVAL_MS
    return request()
  })
  musicBrainzQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function getCoverArt(kind: 'release' | 'release-group', mbid: string): Promise<MusicCoverArt> {
  const empty = emptyCoverArt()
  if (!MBID_PATTERN.test(mbid)) return empty

  let response: Response
  try {
    response = await fetch(`${COVER_ART_ARCHIVE_BASE}/${kind}/${mbid}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': MUSICBRAINZ_USER_AGENT,
      },
    })
  } catch (error) {
    throw new MusicProviderError(
      error instanceof Error
        ? `Cover Art Archive request failed: ${error.message}`
        : 'Cover Art Archive request failed.',
      502,
      'COVER_ART_ARCHIVE_REQUEST_FAILED',
    )
  }
  if (response.status === 404) return empty
  if (!response.ok) {
    throw new MusicProviderError(
      `Cover Art Archive request failed: ${response.status}`,
      502,
      'COVER_ART_ARCHIVE_REQUEST_FAILED',
    )
  }

  return toCoverArt((await response.json()) as CoverArtArchiveResponse)
}

function buildReleaseGroupSearchQuery(input: {
  q?: string
  query?: string
  artist?: string
  title?: string
  tag?: string
  releaseType?: string
  year?: string
}): string {
  const clauses = [`primarytype:${input.releaseType ?? 'album'}`]
  const query = input.query ?? input.q
  if (input.artist) clauses.push(`artist:"${escapeMusicBrainzQuery(input.artist)}"`)
  if (input.title) clauses.push(`releasegroup:"${escapeMusicBrainzQuery(input.title)}"`)
  if (input.tag) clauses.push(`tag:${escapeMusicBrainzQuery(input.tag)}`)
  if (input.year) clauses.push(`firstreleasedate:${escapeMusicBrainzQuery(input.year)}`)
  if (query) clauses.push(escapeMusicBrainzQuery(query))
  return clauses.join(' AND ')
}

function escapeMusicBrainzQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function parseMusicBrainzAlbumMediaKey(
  value: string,
): { resourceType: 'release-group' | 'release'; id: string } | null {
  const parts = parseMusicBrainzMediaKey(value)
  if (!parts) return null
  if (parts.resourceType !== 'release-group' && parts.resourceType !== 'release') return null
  if (!MBID_PATTERN.test(parts.mbid)) return null
  return { resourceType: parts.resourceType, id: parts.mbid }
}

function toMusicAlbumSearchItem(
  releaseGroup: MusicBrainzReleaseGroup,
  coverArt = emptyCoverArt(),
): MusicAlbumSearchItem | null {
  if (!releaseGroup.id || !releaseGroup.title) return null

  const artists = toArtistCredits(releaseGroup['artist-credit'] ?? [])
  return {
    mediaKey: buildMusicBrainzMediaKey('release-group', releaseGroup.id),
    provider: 'musicbrainz',
    resourceType: 'release-group',
    mbid: releaseGroup.id,
    releaseGroupMbid: releaseGroup.id,
    title: releaseGroup.title,
    artist: formatArtistCredit(artists) || null,
    artists,
    firstReleaseDate: releaseGroup['first-release-date'] || null,
    releaseYear: releaseGroup['first-release-date'] ? releaseGroup['first-release-date'].slice(0, 4) : null,
    releaseDate: releaseGroup['first-release-date'] || null,
    country: null,
    primaryType: releaseGroup['primary-type'] || null,
    secondaryTypes: releaseGroup['secondary-types'] ?? [],
    disambiguation: releaseGroup.disambiguation?.trim() || null,
    coverArt,
    scoreLabel: null,
  }
}

function toPopularMusicAlbumSearchItem(release: ListenBrainzTopRelease): MusicAlbumSearchItem | null {
  if (!release.release_mbid || !MBID_PATTERN.test(release.release_mbid) || !release.release_name) return null
  const artistName = release.artist_name?.trim() || null
  const artistMbid = release.artist_mbids?.find((mbid) => MBID_PATTERN.test(mbid)) ?? null
  const scoreLabel =
    typeof release.listen_count === 'number' && Number.isFinite(release.listen_count)
      ? compactNumber.format(release.listen_count)
      : null

  return {
    mediaKey: buildMusicBrainzMediaKey('release', release.release_mbid),
    provider: 'musicbrainz',
    resourceType: 'release',
    mbid: release.release_mbid,
    releaseGroupMbid: release.release_mbid,
    title: release.release_name,
    artist: artistName,
    artists: artistName ? [{ id: artistMbid, name: artistName, joinPhrase: '' }] : [],
    firstReleaseDate: null,
    releaseYear: null,
    releaseDate: null,
    country: null,
    primaryType: 'Album',
    secondaryTypes: [],
    disambiguation: release.listen_count ? `${release.listen_count.toLocaleString()} listens` : null,
    coverArt: getListenBrainzCoverArt(release),
    scoreLabel,
  }
}

function toPopularMusicRecordingSearchItem(recording: ListenBrainzTopRecording): MusicAlbumSearchItem | null {
  const title = recording.track_name ?? recording.recording_name
  if (!recording.caa_release_mbid || !MBID_PATTERN.test(recording.caa_release_mbid) || !title) {
    return null
  }
  const artistName = recording.artist_name?.trim() || null
  const artistMbid = recording.artist_mbids?.find((mbid) => MBID_PATTERN.test(mbid)) ?? null
  const scoreLabel =
    typeof recording.listen_count === 'number' && Number.isFinite(recording.listen_count)
      ? compactNumber.format(recording.listen_count)
      : null

  return {
    mediaKey: buildMusicBrainzMediaKey('release', recording.caa_release_mbid),
    provider: 'musicbrainz',
    resourceType: 'release',
    mbid: recording.caa_release_mbid,
    releaseGroupMbid: recording.caa_release_mbid,
    title,
    artist: artistName,
    artists: artistName ? [{ id: artistMbid, name: artistName, joinPhrase: '' }] : [],
    firstReleaseDate: null,
    releaseYear: null,
    releaseDate: null,
    country: null,
    primaryType: 'Track',
    secondaryTypes: [],
    disambiguation: recording.listen_count ? `${recording.listen_count.toLocaleString()} listens` : null,
    coverArt: getListenBrainzCoverArt(recording),
    scoreLabel,
  }
}

function getListenBrainzCoverArt(release: ListenBrainzTopRelease): MusicCoverArt {
  if (!release.caa_id || !release.caa_release_mbid || !MBID_PATTERN.test(release.caa_release_mbid)) {
    return emptyCoverArt()
  }
  const base = `${COVER_ART_ARCHIVE_BASE}/release/${release.caa_release_mbid}/${release.caa_id}`
  return {
    frontUrl: `${base}.jpg`,
    frontThumbnailUrl: `${base}-250.jpg`,
    backUrl: null,
    backThumbnailUrl: null,
  }
}

function toResourcePage<T>(
  results: T[],
  page: number,
  pageSize: number,
  totalResults = results.length === pageSize ? page * pageSize + 1 : (page - 1) * pageSize + results.length,
): ResourcePage<T> {
  return {
    results,
    page,
    totalPages: Math.max(page, Math.ceil(totalResults / pageSize)),
    totalResults,
  }
}

const compactNumber = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

function toArtistCredits(credits: MusicBrainzArtistCredit[]): MusicArtistCredit[] {
  return credits
    .filter((credit) => credit.name || credit.artist?.name)
    .map((credit) => ({
      id: credit.artist?.id ?? null,
      name: credit.name ?? credit.artist?.name ?? '',
      joinPhrase: credit.joinphrase ?? '',
    }))
}

function formatArtistCredit(artists: MusicArtistCredit[]): string {
  return artists
    .map((artist) => `${artist.name}${artist.joinPhrase}`)
    .join('')
    .trim()
}

function selectPreferredRelease(releases: MusicBrainzRelease[]): MusicBrainzRelease | null {
  const official = releases.filter((release) => release.status === 'Official')
  return [...(official.length > 0 ? official : releases)].sort(compareReleases)[0] ?? null
}

function compareReleases(a: MusicBrainzRelease, b: MusicBrainzRelease): number {
  const date = compareNullableStrings(a.date, b.date)
  if (date !== 0) return date
  return compareNullableStrings(countryRank(a.country), countryRank(b.country))
}

function compareReleaseSummaries(a: MusicReleaseSummary, b: MusicReleaseSummary): number {
  return compareNullableStrings(a.date, b.date)
}

function compareNullableStrings(a: string | null | undefined, b: string | null | undefined): number {
  if (a && b) return a.localeCompare(b)
  if (a) return -1
  if (b) return 1
  return 0
}

function countryRank(country: string | undefined): string | null {
  if (!country) return null
  if (country === 'XW') return '0'
  if (country === 'US') return '1'
  if (country === 'GB') return '2'
  return `3-${country}`
}

function toMusicReleaseSummary(release: MusicBrainzRelease): MusicReleaseSummary | null {
  if (!release.id || !release.title) return null
  return {
    mediaKey: buildMusicBrainzMediaKey('release', release.id),
    mbid: release.id,
    title: release.title,
    date: release.date || null,
    country: release.country || null,
    status: release.status || null,
    barcode: release.barcode || null,
    formats: [
      ...new Set(
        (release.media ?? []).map((medium) => medium.format).filter((format): format is string => Boolean(format)),
      ),
    ],
  }
}

function toMusicAliases(aliases: MusicBrainzAlias[]): MusicAlias[] {
  const seen = new Set<string>()
  return aliases
    .filter((alias): alias is MusicBrainzAlias & { name: string } => Boolean(alias.name?.trim()))
    .map((alias) => ({
      name: alias.name.trim(),
      locale: alias.locale || null,
      primary: alias.primary === true || alias.primary === 'primary',
      type: alias.type || null,
    }))
    .filter((alias) => {
      const key = `${alias.locale ?? ''}:${alias.name}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => Number(b.primary) - Number(a.primary))
}

function getArtistAliases(release: MusicBrainzRelease): MusicBrainzAlias[] {
  return (release['artist-credit'] ?? []).flatMap((credit) => credit.artist?.aliases ?? [])
}

function toMusicMedia(media: MusicBrainzMedium[]): MusicMedium[] {
  return media
    .filter((medium) => typeof medium.position === 'number')
    .map((medium) => ({
      position: medium.position ?? 0,
      format: medium.format || null,
      title: medium.title || null,
      trackCount: medium['track-count'] ?? medium.tracks?.length ?? 0,
      tracks: toMusicTracks(medium.tracks ?? []),
    }))
    .sort((a, b) => a.position - b.position)
}

function toMusicTracks(tracks: MusicBrainzTrack[]): MusicTrack[] {
  return tracks
    .filter((track) => typeof track.position === 'number')
    .map((track) => ({
      position: track.position ?? 0,
      number: track.number || null,
      title: track.title || track.recording?.title || '',
      lengthMs: typeof track.length === 'number' ? track.length : null,
      recordingMbid: track.recording?.id ?? null,
      recordingMediaKey: track.recording?.id ? buildMusicBrainzMediaKey('recording', track.recording.id) : null,
      isrcs: track.recording?.isrcs ?? [],
    }))
    .sort((a, b) => a.position - b.position)
}

function toCoverArt(payload: CoverArtArchiveResponse): MusicCoverArt {
  const images = payload.images ?? []
  const front = images.find((image) => image.front) ?? images.find((image) => image.thumbnails)
  const back = images.find((image) => image.back)
  return {
    frontUrl: front?.image ?? null,
    frontThumbnailUrl: getCoverThumbnail(front),
    backUrl: back?.image ?? null,
    backThumbnailUrl: getCoverThumbnail(back),
  }
}

function getCoverThumbnail(image: CoverArtArchiveImage | undefined): string | null {
  return (
    image?.thumbnails?.['500'] ??
    image?.thumbnails?.large ??
    image?.thumbnails?.['250'] ??
    image?.thumbnails?.small ??
    null
  )
}

function emptyCoverArt(): MusicCoverArt {
  return {
    frontUrl: null,
    frontThumbnailUrl: null,
    backUrl: null,
    backThumbnailUrl: null,
  }
}

function mergeCoverArt(primary: MusicCoverArt, secondary: MusicCoverArt): MusicCoverArt {
  return {
    frontUrl: primary.frontUrl ?? secondary.frontUrl,
    frontThumbnailUrl: primary.frontThumbnailUrl ?? secondary.frontThumbnailUrl,
    backUrl: primary.backUrl ?? secondary.backUrl,
    backThumbnailUrl: primary.backThumbnailUrl ?? secondary.backThumbnailUrl,
  }
}

export const musicBrainzMusicProvider: MusicProvider = {
  search: (input) => searchMusicAlbums(input),
  discover: (input) => discoverMusicAlbums(input),
  details: (mediaKey) => getMusicAlbumDetails(mediaKey),
}
