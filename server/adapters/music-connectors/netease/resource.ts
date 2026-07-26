import {
  type MusicAvailabilityInterruption,
  MusicResourceUnavailableError,
  type MusicTrackAvailabilityCheckResult,
  type MusicTrackAvailabilityResult,
  type ResolvedMusicResource,
} from '@server/usecases/ports'
import type { MusicDownloadQuality } from '@shared/types'
import { eapiRequest, NETEASE_BASE, neteaseError } from './client'
import type { NeteasePlaybackResource } from './types'

export async function resolveResource(
  credentials: string[],
  input: { trackId: string; quality: MusicDownloadQuality },
): Promise<ResolvedMusicResource> {
  if (!/^\d+$/.test(input.trackId)) throw new Error('Netease track id is invalid.')
  const item = (await getPlaybackResources(credentials, [Number(input.trackId)], input.quality)).find(
    (value) => String(value.id) === input.trackId,
  )
  if (!isFullResource(item)) {
    const availability = classifyResource(item)
    throw new MusicResourceUnavailableError(availabilityMessage(availability), availability)
  }

  const url = normalizeMediaUrl(item.url)
  const quality = normalizeResolvedQuality(item.level, input.quality)
  const extension = normalizeAudioExtension(item.type, url)
  return {
    url: url.toString(),
    headers: { Referer: `${NETEASE_BASE}/`, 'User-Agent': 'Mozilla/5.0 ZME/0.0.1' },
    quality,
    extension,
    contentType: contentTypeForAudioExtension(extension),
    contentLength: typeof item.size === 'number' && item.size >= 0 ? item.size : null,
  }
}

export async function checkTrackAvailability(
  credentials: string[],
  trackIds: string[],
): Promise<MusicTrackAvailabilityCheckResult> {
  const uniqueTrackIds = [...new Set(trackIds)]
  if (uniqueTrackIds.some((id) => !/^\d+$/.test(id))) throw new Error('Netease track id is invalid.')
  const ids = uniqueTrackIds.map(Number)
  const results = new Map<string, MusicTrackAvailabilityResult>()
  let interrupted: MusicAvailabilityInterruption | null = null
  for (let offset = 0; offset < ids.length; offset += 100) {
    const pageIds = ids.slice(offset, offset + 100)
    try {
      const resources = await getPlaybackResources(credentials, pageIds, 'standard')
      interrupted = getInterruption(resources)
      if (interrupted) break
      const byId = new Map(resources.flatMap((item) => (item.id ? [[item.id, item] as const] : [])))
      for (const id of pageIds) results.set(String(id), classifyResource(byId.get(id)))
    } catch (error) {
      interrupted = classifyInterruption(error)
      break
    }
  }
  return { results, interrupted }
}

async function getPlaybackResources(
  credentials: string[],
  ids: number[],
  quality: MusicDownloadQuality,
): Promise<NeteasePlaybackResource[]> {
  const response = await eapiRequest<{ code?: number; message?: string; data?: NeteasePlaybackResource[] }>(
    '/api/song/enhance/player/url/v1',
    { ids: JSON.stringify(ids), level: quality, encodeType: 'flac' },
    credentials,
  )
  if (response.body.code !== 200) throw new Error(neteaseError('Netease failed to resolve tracks', response.body))
  return response.body.data ?? []
}

function isFullResource(item: NeteasePlaybackResource | undefined): item is NeteasePlaybackResource & { url: string } {
  return Boolean(item?.url && item.code === 200 && !item.freeTrialInfo)
}

function classifyResource(item: NeteasePlaybackResource | undefined): MusicTrackAvailabilityResult {
  if (!item) return { status: 'unknown', reason: 'malformed_response', providerCode: null, providerDetails: {} }
  const providerCode = item.code === undefined ? null : String(item.code)
  const providerDetails = Object.fromEntries(
    Object.entries({
      fee: item.fee,
      payed: item.payed,
      level: item.level,
      freeTrial: Boolean(item.freeTrialInfo),
      st: item.st,
      toast: item.toast,
    }).filter((entry): entry is [string, string | number | boolean | null] => entry[1] !== undefined),
  )
  if (isFullResource(item)) return { status: 'available', reason: null, providerCode, providerDetails }
  if (item.freeTrialInfo) return { status: 'unavailable', reason: 'trial_only', providerCode, providerDetails }
  if (item.fee === 1 && !item.payed)
    return { status: 'unavailable', reason: 'membership_required', providerCode, providerDetails }
  if (item.fee === 4 && !item.payed)
    return { status: 'unavailable', reason: 'purchase_required', providerCode, providerDetails }
  if (item.toast) return { status: 'unavailable', reason: 'region_restricted', providerCode, providerDetails }
  if (typeof item.st === 'number' && item.st < 0) {
    return { status: 'unavailable', reason: 'removed_or_unlicensed', providerCode, providerDetails }
  }
  return { status: 'unavailable', reason: 'provider_unavailable', providerCode, providerDetails }
}

function getInterruption(resources: NeteasePlaybackResource[]): MusicAvailabilityInterruption | null {
  const item = resources.find((resource) => [401, 403, 429, -460, -462].includes(resource.code ?? 0))
  if (!item) return null
  const providerCode = String(item.code)
  if (item.code === 401) {
    return {
      reason: 'authentication_required',
      providerCode,
      message: `Netease availability check requires authentication (code ${providerCode}).`,
    }
  }
  if (item.code === 429) {
    return {
      reason: 'rate_limited',
      providerCode,
      message: `Netease availability check was rate limited (code ${providerCode}).`,
    }
  }
  return {
    reason: 'risk_control',
    providerCode,
    message: `Netease availability check was interrupted by risk control (code ${providerCode}).`,
  }
}

function classifyInterruption(error: unknown): MusicAvailabilityInterruption {
  const message = error instanceof Error ? error.message : 'Netease availability check was interrupted.'
  const providerCode = message.match(/(?:code |failed: )(-?\d+)/i)?.[1] ?? null
  if (providerCode === '401') return { reason: 'authentication_required', providerCode, message }
  if (providerCode === '429') return { reason: 'rate_limited', providerCode, message }
  if (providerCode === '403' || providerCode === '-460' || providerCode === '-462') {
    return { reason: 'risk_control', providerCode, message }
  }
  return { reason: 'provider_error', providerCode, message }
}

function availabilityMessage(result: MusicTrackAvailabilityResult): string {
  if (result.reason === 'membership_required') return 'A Netease membership is required for this track.'
  if (result.reason === 'purchase_required') return 'This Netease track must be purchased separately.'
  if (result.reason === 'trial_only') return 'Netease only returned a trial preview for this track.'
  if (result.reason === 'region_restricted') return 'This Netease track is unavailable in the current region.'
  if (result.reason === 'removed_or_unlicensed') return 'This Netease track was removed or is unlicensed.'
  if (result.reason === 'authentication_required') return 'The Netease account must be authenticated again.'
  return 'The full Netease track is not available for this account.'
}

function normalizeResolvedQuality(
  level: string | null | undefined,
  requested: MusicDownloadQuality,
): MusicDownloadQuality {
  if (level === 'standard' || level === 'exhigh' || level === 'lossless' || level === 'hires') return level
  if (level === 'higher') return 'standard'
  return requested
}

function normalizeMediaUrl(value: string): URL {
  const url = new URL(value)
  const hostname = url.hostname.toLowerCase()
  const trustedHost =
    hostname === 'music.126.net' ||
    hostname.endsWith('.music.126.net') ||
    hostname === 'music.163.com' ||
    hostname.endsWith('.music.163.com')
  if (!trustedHost || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new Error('Netease returned an untrusted media URL.')
  }
  if (url.port && url.port !== '80' && url.port !== '443') throw new Error('Netease returned an untrusted media URL.')
  url.protocol = 'https:'
  url.port = ''
  url.username = ''
  url.password = ''
  return url
}

function normalizeAudioExtension(value: string | null | undefined, url: URL): string {
  const extension = value?.toLowerCase()
  if (extension && /^[a-z0-9]{2,5}$/.test(extension)) return extension
  const pathnameExtension = url.pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase()
  if (pathnameExtension) return pathnameExtension
  throw new Error('Netease returned a music resource without a usable format.')
}

function contentTypeForAudioExtension(extension: string): string | null {
  if (extension === 'mp3') return 'audio/mpeg'
  if (extension === 'flac') return 'audio/flac'
  if (extension === 'aac') return 'audio/aac'
  if (extension === 'm4a' || extension === 'm4b' || extension === 'mp4') return 'audio/mp4'
  if (extension === 'ogg' || extension === 'oga' || extension === 'opus') return 'audio/ogg'
  return null
}
