import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  publicEncrypt,
  randomBytes,
} from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import {
  type ImportedMusicAlbum,
  type ImportedMusicPlaylist,
  type ImportedMusicTrack,
  type MusicAvailabilityInterruption,
  type MusicPlaylistConnector,
  type MusicResourceResolver,
  MusicResourceUnavailableError,
  type MusicTrackAvailabilityResult,
} from '@server/usecases/ports'
import type { MusicDownloadQuality } from '@shared/types'

const NETEASE_BASE = 'https://music.163.com'
const NETEASE_INTERFACE_BASE = 'https://interface.music.163.com'
const WEAPI_IV = '0102030405060708'
const WEAPI_PRESET_KEY = '0CoJUm6Qyw8W8jud'
const EAPI_KEY = 'e82ckenh8dichen8'
const XEAPI_BASE = 'https://interface3.music.163.com'
const XEAPI_STATIC_KEY = Buffer.from('ab1d5a430f6bb04a3f01e81ddd72bd916d5ce591248ac128714806d7f8fb1b84', 'hex')
const XEAPI_SIGN_KEY = 'mUHCwVNWJbunMqAHf5MImuirT6plvs6VSFW62MGHstFQxhBGdEoIhLItH3djc4+FB/OKty3+lL2rGeoFBpVe5g=='
const ANONYMOUS_ID_XOR_KEY = '3go8&$8*3*3h0k(2)2'
const WEAPI_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`
const SECRET_CHARACTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const NETEASE_ALBUM_REQUEST_INTERVAL_MS = 250

interface NeteaseArtist {
  name?: string
}

interface NeteaseProfile {
  userId?: number
  nickname?: string
  avatarUrl?: string
}

interface NeteasePlaylist {
  id?: number
  name?: string
  description?: string | null
  coverImgUrl?: string
  trackCount?: number
  updateTime?: number
  creator?: { nickname?: string }
}

interface NeteaseSong {
  id?: number
  name?: string
  dt?: number
  no?: number
  cd?: string | number
  ar?: NeteaseArtist[]
  al?: { id?: number; name?: string; picUrl?: string }
}

interface NeteaseAlbum {
  id?: number
  name?: string
  type?: string
  subType?: string
  publishTime?: number
  picUrl?: string
  artist?: NeteaseArtist
  artists?: NeteaseArtist[]
}

interface NeteasePlaybackResource {
  id?: number
  url?: string | null
  type?: string | null
  size?: number | null
  level?: string | null
  code?: number
  freeTrialInfo?: unknown
  fee?: number
  payed?: number
  st?: number
  toast?: boolean
}

interface NeteaseRiskData {
  verifyId?: string | number
  verifyType?: string | number
  verifyToken?: string
  params?: { event_id?: string; sign?: string } | string
}

interface XeapiPublicKey {
  publicKey: string
  sk: string
  version: string
}

export const neteasePlaylistConnector: MusicPlaylistConnector = {
  async beginQrLogin() {
    const response = await eapiRequest<{
      code?: number
      message?: string
      unikey?: string
      data?: { unikey?: string }
    }>('/api/login/qrcode/unikey', { type: 3 }, [])
    const key = response.body.data?.unikey ?? response.body.unikey
    if (!key) {
      throw new Error(
        `Netease did not return a QR login key (code ${response.body.code ?? 'unknown'}${response.body.message ? `: ${response.body.message}` : ''}).`,
      )
    }
    return {
      key,
      qrUrl: `${NETEASE_BASE}/login?codekey=${encodeURIComponent(key)}`,
      cookies: response.cookies,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    }
  },

  async checkQrLogin(key, cookies) {
    const sessionCookies = await ensureAnonymousSession(cookies)
    const response = await eapiRequest<{ code?: number; message?: string; data?: NeteaseRiskData }>(
      '/api/login/qrcode/client/login',
      { key, type: 3 },
      sessionCookies,
    )
    const mergedCookies = mergeCookies(sessionCookies, response.cookies)
    if (response.body.code === 800) return { status: 'expired', cookies: mergedCookies }
    if (response.body.code === 801) return { status: 'waiting_scan', cookies: mergedCookies }
    if (response.body.code === 802) return { status: 'waiting_confirmation', cookies: mergedCookies }
    if ((response.body.code === -462 || response.body.code === 8821) && response.body.data) {
      const verification = await createRiskVerification(response.body.data, mergedCookies)
      return { status: 'verification_required', cookies: verification.cookies, verification: verification.challenge }
    }
    if (response.body.code !== 803) throw new Error(neteaseError('Netease QR login failed', response.body))

    const account = await getAccount(mergedCookies)
    return {
      status: 'connected',
      cookies: account.cookies,
      account: account.profile,
    }
  },

  async sendSmsCode({ countryCode, phone }) {
    const response = await weapiRequest<{ code?: number; message?: string }>(
      '/weapi/sms/captcha/sent',
      { ctcode: countryCode, cellphone: phone, secrete: 'music_middleuser_pclogin' },
      [],
    )
    if (response.body.code !== 200) {
      throw new Error(neteaseError('Netease failed to send the SMS code', response.body))
    }
  },

  async loginWithSms({ countryCode, phone, code }, cookies) {
    const sessionCookies = await ensureAnonymousSession(cookies)
    const response = await eapiRequest<{ code?: number; message?: string; data?: NeteaseRiskData }>(
      '/api/w/login/cellphone',
      {
        type: '1',
        https: 'true',
        phone,
        countrycode: countryCode,
        captcha: code,
        remember: 'true',
      },
      sessionCookies,
    )
    if ((response.body.code === -462 || response.body.code === 8860) && response.body.data) {
      const verification = await createRiskVerification(response.body.data, response.cookies)
      return { status: 'verification_required', cookies: verification.cookies, verification: verification.challenge }
    }
    if (response.body.code !== 200) {
      throw new Error(neteaseError('Netease SMS login failed', response.body))
    }
    const account = await getAccount(response.cookies)
    return { status: 'connected', cookies: account.cookies, account: account.profile }
  },

  async checkRiskVerification(qrCode, cookies) {
    const response = await weapiRequest<{
      code?: number
      message?: string
      qrCodeStatus?: number
      detailReason?: number
      data?: { qrCodeStatus?: number; detailReason?: number }
    }>('/weapi/frontrisk/verify/qrcodestatus', { qrCode }, cookies)
    const status = response.body.data?.qrCodeStatus ?? response.body.qrCodeStatus
    const detailReason = response.body.data?.detailReason ?? response.body.detailReason
    const mergedCookies = mergeCookies(cookies, response.cookies)
    if (status === 0 && detailReason === 0) return { status: 'waiting_scan', cookies: mergedCookies }
    if (status === 10 && detailReason === 0) return { status: 'waiting_confirmation', cookies: mergedCookies }
    if (status === 20 && detailReason === 0) return { status: 'connected', cookies: mergedCookies }
    if (status === 21) return { status: 'expired', cookies: mergedCookies }
    if (detailReason === 303) throw new Error('The Netease verification was scanned by a different account.')
    throw new Error(neteaseError('Netease account verification failed', response.body))
  },

  async listPlaylists(credentials) {
    const accountResponse = await weapiRequest<{ profile?: NeteaseProfile }>(
      '/weapi/w/nuser/account/get',
      {},
      credentials,
    )
    const userId = accountResponse.body.profile?.userId
    if (!userId) throw new Error('Netease session has expired.')

    const playlists: ImportedMusicPlaylist[] = []
    for (let offset = 0; ; offset += 100) {
      const response = await weapiRequest<{ playlist?: NeteasePlaylist[]; more?: boolean }>(
        '/weapi/user/playlist',
        { uid: userId, limit: 100, offset, includeVideo: true },
        credentials,
      )
      const page = (response.body.playlist ?? []).map(toPlaylist).filter((item) => item !== null)
      playlists.push(...page)
      if (!response.body.more || page.length === 0) break
    }
    return playlists
  },

  async listTracks(credentials, playlistId) {
    const detail = await weapiRequest<{ playlist?: { trackIds?: Array<{ id?: number }> } }>(
      '/weapi/v6/playlist/detail',
      { id: playlistId, n: 100_000, s: 8 },
      credentials,
    )
    const ids = (detail.body.playlist?.trackIds ?? []).flatMap((item) => (item.id ? [item.id] : []))
    const tracks: ImportedMusicTrack[] = []
    for (let offset = 0; offset < ids.length; offset += 500) {
      const pageIds = ids.slice(offset, offset + 500)
      const response = await weapiRequest<{ songs?: NeteaseSong[] }>(
        '/weapi/v3/song/detail',
        { c: JSON.stringify(pageIds.map((id) => ({ id }))) },
        credentials,
      )
      tracks.push(...(response.body.songs ?? []).map(toTrack).filter((item) => item !== null))
    }
    return tracks
  },

  async getAlbums(credentials, albumIds) {
    const uniqueAlbumIds = [...new Set(albumIds)]
    if (uniqueAlbumIds.some((id) => !/^\d+$/.test(id))) throw new Error('Netease album id is invalid.')

    const albums: ImportedMusicAlbum[] = []
    for (const [index, albumId] of uniqueAlbumIds.entries()) {
      const response = await weapiRequest<{ code?: number; message?: string; album?: NeteaseAlbum }>(
        `/weapi/v1/album/${albumId}`,
        {},
        credentials,
      )
      if (response.body.code !== 200) {
        throw new Error(neteaseError(`Netease failed to load album ${albumId}`, response.body))
      }
      const album = toAlbum(response.body.album)
      if (!album || album.externalId !== albumId) {
        throw new Error(`Netease album ${albumId} response is incomplete.`)
      }
      albums.push(album)
      if (index < uniqueAlbumIds.length - 1) await delay(NETEASE_ALBUM_REQUEST_INTERVAL_MS)
    }
    return albums
  },

  async checkTrackAvailability(credentials, trackIds) {
    const uniqueTrackIds = [...new Set(trackIds)]
    if (uniqueTrackIds.some((id) => !/^\d+$/.test(id))) throw new Error('Netease track id is invalid.')
    const ids = uniqueTrackIds.map(Number)
    const results = new Map<string, MusicTrackAvailabilityResult>()
    let interrupted: MusicAvailabilityInterruption | null = null
    for (let offset = 0; offset < ids.length; offset += 100) {
      const pageIds = ids.slice(offset, offset + 100)
      try {
        const resources = await getNeteasePlaybackResources(credentials, pageIds, 'standard')
        interrupted = getNeteaseInterruption(resources)
        if (interrupted) {
          break
        }
        const byId = new Map(resources.flatMap((item) => (item.id ? [[item.id, item] as const] : [])))
        for (const id of pageIds) {
          results.set(String(id), classifyNeteaseResource(byId.get(id)))
        }
      } catch (error) {
        interrupted = classifyNeteaseInterruption(error)
        break
      }
    }
    return { results, interrupted }
  },
}

export const neteaseMusicResourceResolver: MusicResourceResolver = {
  async resolve(credentials, input) {
    if (!/^\d+$/.test(input.trackId)) throw new Error('Netease track id is invalid.')
    const item = (await getNeteasePlaybackResources(credentials, [Number(input.trackId)], input.quality)).find(
      (value) => String(value.id) === input.trackId,
    )
    if (!isFullNeteaseResource(item)) {
      const availability = classifyNeteaseResource(item)
      throw new MusicResourceUnavailableError(availabilityMessage(availability), availability)
    }

    const url = normalizeNeteaseMediaUrl(item.url)
    const quality = normalizeResolvedQuality(item.level, input.quality)
    const extension = normalizeAudioExtension(item.type, quality)
    return {
      url: url.toString(),
      headers: {
        Referer: `${NETEASE_BASE}/`,
        'User-Agent': 'Mozilla/5.0 ZME/0.0.1',
      },
      quality,
      extension,
      contentType: extension === 'flac' ? 'audio/flac' : 'audio/mpeg',
      contentLength: typeof item.size === 'number' && item.size >= 0 ? item.size : null,
    }
  },
}

async function getNeteasePlaybackResources(
  credentials: string[],
  ids: number[],
  quality: MusicDownloadQuality,
): Promise<NeteasePlaybackResource[]> {
  const response = await eapiRequest<{ code?: number; message?: string; data?: NeteasePlaybackResource[] }>(
    '/api/song/enhance/player/url/v1',
    { ids: JSON.stringify(ids), level: quality, encodeType: 'flac' },
    credentials,
  )
  if (response.body.code !== 200) {
    throw new Error(neteaseError('Netease failed to resolve tracks', response.body))
  }
  return response.body.data ?? []
}

function isFullNeteaseResource(item: NeteasePlaybackResource | undefined): item is NeteasePlaybackResource & {
  url: string
} {
  return Boolean(item?.url && item.code === 200 && !item.freeTrialInfo)
}

function classifyNeteaseResource(item: NeteasePlaybackResource | undefined): MusicTrackAvailabilityResult {
  if (!item) {
    return {
      status: 'unknown',
      reason: 'malformed_response',
      providerCode: null,
      providerDetails: {},
    }
  }

  const providerCode = item.code === undefined ? null : String(item.code)
  const providerDetails = neteaseProviderDetails(item)
  if (isFullNeteaseResource(item)) return { status: 'available', reason: null, providerCode, providerDetails }
  if (item.freeTrialInfo) return { status: 'unavailable', reason: 'trial_only', providerCode, providerDetails }
  if (item.fee === 1 && !item.payed) {
    return { status: 'unavailable', reason: 'membership_required', providerCode, providerDetails }
  }
  if (item.fee === 4 && !item.payed) {
    return { status: 'unavailable', reason: 'purchase_required', providerCode, providerDetails }
  }
  if (item.toast) return { status: 'unavailable', reason: 'region_restricted', providerCode, providerDetails }
  if (typeof item.st === 'number' && item.st < 0) {
    return { status: 'unavailable', reason: 'removed_or_unlicensed', providerCode, providerDetails }
  }
  return { status: 'unavailable', reason: 'provider_unavailable', providerCode, providerDetails }
}

function neteaseProviderDetails(item: NeteasePlaybackResource) {
  return Object.fromEntries(
    Object.entries({
      fee: item.fee,
      payed: item.payed,
      level: item.level,
      freeTrial: Boolean(item.freeTrialInfo),
      st: item.st,
      toast: item.toast,
    }).filter((entry): entry is [string, string | number | boolean | null] => entry[1] !== undefined),
  )
}

function getNeteaseInterruption(resources: NeteasePlaybackResource[]): MusicAvailabilityInterruption | null {
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

function classifyNeteaseInterruption(error: unknown): MusicAvailabilityInterruption {
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

function normalizeNeteaseMediaUrl(value: string): URL {
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
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new Error('Netease returned an untrusted media URL.')
  }
  url.protocol = 'https:'
  url.port = ''
  url.username = ''
  url.password = ''
  return url
}

function normalizeAudioExtension(value: string | null | undefined, quality: string): string {
  const extension = value?.toLowerCase()
  if (extension === 'mp3' || extension === 'flac') return extension
  return quality === 'lossless' || quality === 'hires' ? 'flac' : 'mp3'
}

async function createRiskVerification(data: NeteaseRiskData, cookies: string[]) {
  const params = typeof data.params === 'string' ? (JSON.parse(data.params) as NeteaseRiskData['params']) : data.params
  const verifyId = data.verifyId
  const verifyType = data.verifyType
  const verifyToken = data.verifyToken
  const eventId = typeof params === 'object' ? params?.event_id : undefined
  const sign = typeof params === 'object' ? params?.sign : undefined
  if (verifyId === undefined || verifyType === undefined || !verifyToken || !eventId || !sign) {
    throw new Error('Netease did not return account verification details.')
  }

  const verificationParams = JSON.stringify({ event_id: eventId, sign })
  const response = await weapiRequest<{ code?: number; message?: string; data?: { qrCode?: string } }>(
    '/weapi/frontrisk/verify/getqrcode',
    {
      verifyConfigId: verifyId,
      verifyType,
      token: verifyToken,
      params: verificationParams,
      size: 150,
    },
    cookies,
  )
  const qrCode = response.body.data?.qrCode
  if (!qrCode) throw new Error(neteaseError('Netease did not return an account verification QR code', response.body))

  const query = new URLSearchParams({
    qrCode,
    verifyToken,
    verifyId: String(verifyId),
    verifyType: String(verifyType),
    params: verificationParams,
  })
  return {
    cookies: mergeCookies(cookies, response.cookies),
    challenge: {
      qrCode,
      qrUrl: `https://st.music.163.com/encrypt-pages?${query.toString()}`,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    },
  }
}

async function getAccount(cookies: string[]) {
  const response = await weapiRequest<{ profile?: NeteaseProfile }>('/weapi/w/nuser/account/get', {}, cookies)
  const profile = response.body.profile
  if (!profile?.userId || !profile.nickname) throw new Error('Netease account profile is unavailable.')
  return {
    cookies: mergeCookies(cookies, response.cookies),
    profile: {
      externalAccountId: String(profile.userId),
      displayName: profile.nickname,
      avatarUrl: profile.avatarUrl ?? null,
    },
  }
}

function neteaseError(prefix: string, response: { code?: number; message?: string }): string {
  return `${prefix} (code ${response.code ?? 'unknown'}${response.message ? `: ${response.message}` : ''}).`
}

async function weapiRequest<T>(path: string, data: Record<string, unknown>, cookies: string[]) {
  const payload = await encryptWeapi({ ...data, csrf_token: readCookie(cookies, '__csrf') ?? '' })
  const response = await fetch(`${NETEASE_BASE}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookies.join('; '),
      Referer: NETEASE_BASE,
      'User-Agent': 'Mozilla/5.0 ZME/0.0.1',
    },
    body: new URLSearchParams(payload),
  })
  if (!response.ok) throw new Error(`Netease request failed: ${response.status}`)
  return { body: (await response.json()) as T, cookies: readResponseCookies(response.headers) }
}

async function eapiRequest<T>(path: string, data: Record<string, unknown>, cookies: string[]) {
  const contextCookies = mergeCookies(cookies, [
    `deviceId=${readCookie(cookies, 'deviceId') ?? randomDeviceId()}`,
    `NMTID=${readCookie(cookies, 'NMTID') ?? randomHex(16)}`,
    'os=pc',
    'appver=3.1.17.204416',
  ])
  const header = createEapiHeader(contextCookies)
  const headerCookies = Object.entries(header).map(
    ([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
  )
  const response = await fetch(`${NETEASE_INTERFACE_BASE}/eapi/${path.slice('/api/'.length)}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: mergeCookies(contextCookies, headerCookies).join('; '),
      'User-Agent': 'NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)',
    },
    body: new URLSearchParams({ params: encryptEapi(path, { ...data, e_r: false, header }) }),
  })
  if (!response.ok) throw new Error(`Netease request failed: ${response.status}`)
  return {
    body: (await response.json()) as T,
    cookies: mergeCookies(contextCookies, readResponseCookies(response.headers)),
  }
}

function createEapiHeader(cookies: string[]) {
  const header: Record<string, string> = {
    osver: 'Microsoft-Windows-10-Professional-build-19045-64bit',
    deviceId: readCookie(cookies, 'deviceId') ?? randomHex(16),
    os: 'pc',
    appver: '3.1.17.204416',
    versioncode: '140',
    mobilename: '',
    buildver: String(Math.floor(Date.now() / 1000)),
    resolution: '1920x1080',
    __csrf: readCookie(cookies, '__csrf') ?? '',
    channel: 'netease',
    requestId: `${Date.now()}_${String(Math.floor(Math.random() * 1000)).padStart(4, '0')}`,
  }
  const musicU = readCookie(cookies, 'MUSIC_U')
  const musicA = readCookie(cookies, 'MUSIC_A')
  if (musicU) header.MUSIC_U = musicU
  if (musicA) header.MUSIC_A = musicA
  return header
}

export function encryptEapi(path: string, data: Record<string, unknown>): string {
  const text = JSON.stringify(data)
  const digest = createHash('md5').update(`nobody${path}use${text}md5forencrypt`).digest('hex')
  const plaintext = `${path}-36cd479b6b5-${text}-36cd479b6b5-${digest}`
  const cipher = createCipheriv('aes-128-ecb', EAPI_KEY, new Uint8Array(0))
  return Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    .toString('hex')
    .toUpperCase()
}

async function ensureAnonymousSession(cookies: string[]): Promise<string[]> {
  if (readCookie(cookies, 'MUSIC_A')) return cookies

  const deviceId = readCookie(cookies, 'deviceId') ?? randomDeviceId()
  const publicKey = await fetchXeapiPublicKey(deviceId)
  const username = encodeAnonymousUsername(deviceId)
  const response = await xeapiRequest<{ code?: number; message?: string }>(
    '/api/register/anonimous',
    { username },
    deviceId,
    publicKey,
  )
  const sessionCookies = mergeCookies(cookies, [`deviceId=${deviceId}`, ...response.cookies])
  if (response.body.code !== 200 || !readCookie(sessionCookies, 'MUSIC_A')) {
    throw new Error(neteaseError('Netease anonymous device registration failed', response.body))
  }
  return sessionCookies
}

async function fetchXeapiPublicKey(deviceId: string): Promise<XeapiPublicKey> {
  const nonce = randomDigits(16)
  const timestamp = String(Date.now())
  const response = await fetch(`${NETEASE_INTERFACE_BASE}/api/gorilla/anti/crawler/security/key/get`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: `deviceId=${encodeURIComponent(deviceId)}`,
      'User-Agent':
        'NeteaseMusic/9.1.65.240927161425(9001065);Dalvik/2.1.0 (Linux; U; Android 14; 23013RK75C Build/UKQ1.230804.001)',
    },
    body: new URLSearchParams({
      appVersion: '9.1.65',
      currentKeyVersion: '',
      deviceId,
      nonce,
      os: 'android',
      requestType: 'active',
      signature: signXeapi(timestamp, nonce),
      t1: '',
      t2: '',
      timestamp,
      uid: '',
    }),
  })
  if (!response.ok) throw new Error(`Netease request failed: ${response.status}`)
  const body = (await response.json()) as {
    code?: number
    data?: { encryptedData?: string; signature?: string; timestamp?: string | number }
  }
  const data = body.data
  if (body.code !== 200 || !data?.encryptedData || !data.signature || data.timestamp === undefined) {
    throw new Error('Netease XEAPI public key response is invalid.')
  }
  if (data.signature !== signXeapi(String(data.timestamp), nonce)) {
    throw new Error('Netease XEAPI public key signature is invalid.')
  }
  const publicKey = JSON.parse(
    aesEcbDecrypt(XEAPI_STATIC_KEY, Buffer.from(data.encryptedData, 'base64')).toString(),
  ) as Partial<XeapiPublicKey>
  if (!publicKey.publicKey || !publicKey.sk || !publicKey.version) {
    throw new Error('Netease XEAPI public key is incomplete.')
  }
  return publicKey as XeapiPublicKey
}

async function xeapiRequest<T>(
  path: string,
  data: Record<string, string>,
  deviceId: string,
  publicKey: XeapiPublicKey,
) {
  const encrypted = await encryptXeapi(data, publicKey)
  const buildver = String(Math.floor(Date.now() / 1000))
  const response = await fetch(`${XEAPI_BASE}/xeapi/${path.slice('/api/'.length)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      Cookie: `deviceId=${encodeURIComponent(deviceId)}; sDeviceId=${encodeURIComponent(deviceId)}; os=android; osver=14; appver=9.1.65; buildver=${buildver}`,
      'User-Agent':
        'NeteaseMusic/9.1.65.240927161425(9001065);Dalvik/2.1.0 (Linux; U; Android 14; 23013RK75C Build/UKQ1.230804.001)',
      'X-Client-Enc-State': 'ENCRYPTED',
      'x-aeapi': 'true',
      'x-appver': '9.1.65',
      'x-buildver': buildver,
      'x-deviceid': deviceId,
      'x-os': 'android',
      'x-osver': '14',
      'x-sdeviceid': deviceId,
    },
    body: new URLSearchParams(encrypted),
  })
  if (!response.ok) throw new Error(`Netease request failed: ${response.status}`)
  const decrypted = aesEcbDecrypt(EAPI_KEY, Buffer.from(await response.arrayBuffer()))
  const payload = decrypted[0] === 0x1f && decrypted[1] === 0x8b ? gunzipSync(decrypted) : decrypted
  return { body: JSON.parse(payload.toString()) as T, cookies: readResponseCookies(response.headers) }
}

export async function encryptXeapi(data: Record<string, string>, publicKey: XeapiPublicKey) {
  const body = new URLSearchParams(data).toString()
  const plaintext = Buffer.from(
    JSON.stringify({
      body: Buffer.from(body).toString('base64'),
      queryString: 'e_r=true',
    }),
  )
  const dynamicKey = randomBytes(16)
  const firstPass = aesEcbEncrypt(XEAPI_STATIC_KEY, plaintext)
  const transformed = transformXeapiCiphertext(firstPass)
  return {
    B: aesEcbEncrypt(dynamicKey, transformed).toString('base64'),
    S: (await encryptXeapiSessionKey(dynamicKey, publicKey)).toString('base64'),
    R: aesEcbEncrypt(XEAPI_STATIC_KEY, Buffer.from(`${publicKey.version}|`)).toString('base64'),
  }
}

async function encryptXeapiSessionKey(dynamicKey: Buffer, publicKey: XeapiPublicKey): Promise<Buffer> {
  const peerKey = await crypto.subtle.importKey(
    'raw',
    Buffer.from(publicKey.publicKey, 'base64'),
    { name: 'X25519' },
    false,
    [],
  )
  const ephemeral = (await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as CryptoKeyPair
  const ephemeralRaw = Buffer.from(await crypto.subtle.exportKey('raw', ephemeral.publicKey))
  const sharedSecret = Buffer.from(
    await crypto.subtle.deriveBits({ name: 'X25519', public: peerKey }, ephemeral.privateKey, 256),
  )
  const prk = createHmac('sha256', Buffer.alloc(32)).update(sharedSecret).digest()
  const aesKey = createHmac('sha256', prk)
    .update(Buffer.concat([ephemeralRaw, Buffer.from([1])]))
    .digest()
    .subarray(0, 16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-128-gcm', aesKey, iv)
  const plaintext = Buffer.from(`${dynamicKey.toString('base64')}|android|${publicKey.sk}`)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([ephemeralRaw, iv, encrypted, cipher.getAuthTag()])
}

function transformXeapiCiphertext(ciphertext: Buffer): Buffer {
  const random = randomBytes(16)
  const xored = Buffer.alloc(ciphertext.length)
  for (let index = 0; index < ciphertext.length; index += 1) {
    xored[index] = ciphertext[index] ^ random[index & 0x0f]
  }
  const encoded = Buffer.from(xored.toString('base64'))
  const rotation = encoded.length ? (random[0] & 0x0f) % encoded.length : 0
  return Buffer.concat([random, encoded.subarray(rotation), encoded.subarray(0, rotation)])
}

function aesEcbEncrypt(key: string | Buffer, plaintext: Buffer): Buffer {
  const cipher = createCipheriv(`aes-${Buffer.byteLength(key) * 8}-ecb`, key, new Uint8Array(0))
  return Buffer.concat([cipher.update(plaintext), cipher.final()])
}

function aesEcbDecrypt(key: string | Buffer, ciphertext: Buffer): Buffer {
  const decipher = createDecipheriv(`aes-${Buffer.byteLength(key) * 8}-ecb`, key, new Uint8Array(0))
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

function encodeAnonymousUsername(deviceId: string): string {
  let xored = ''
  for (let index = 0; index < deviceId.length; index += 1) {
    xored += String.fromCharCode(
      deviceId.charCodeAt(index) ^ ANONYMOUS_ID_XOR_KEY.charCodeAt(index % ANONYMOUS_ID_XOR_KEY.length),
    )
  }
  const digest = createHash('md5').update(xored).digest('base64')
  return Buffer.from(`${deviceId} ${digest}`).toString('base64')
}

function signXeapi(timestamp: string, nonce: string): string {
  return createHmac('sha256', XEAPI_SIGN_KEY)
    .update(timestamp + nonce)
    .digest('base64')
}

function randomDeviceId(): string {
  return randomHex(26).toUpperCase()
}

function randomDigits(length: number): string {
  return [...crypto.getRandomValues(new Uint8Array(length))].map((value) => String(value % 10)).join('')
}

function readCookie(cookies: string[], name: string): string | null {
  const prefix = `${name}=`
  const value = cookies.find((cookie) => cookie.startsWith(prefix))
  return value ? value.slice(prefix.length) : null
}

async function encryptWeapi(data: Record<string, unknown>): Promise<{ params: string; encSecKey: string }> {
  const secretKey = randomSecret()
  const firstPass = await aesCbcEncrypt(JSON.stringify(data), WEAPI_PRESET_KEY)
  const params = await aesCbcEncrypt(firstPass, secretKey)
  const reversed = new TextEncoder().encode([...secretKey].reverse().join(''))
  const padded = new Uint8Array(128)
  padded.set(reversed, padded.length - reversed.length)
  const encSecKey = publicEncrypt({ key: WEAPI_PUBLIC_KEY, padding: constants.RSA_NO_PADDING }, padded).toString('hex')
  return { params, encSecKey }
}

async function aesCbcEncrypt(value: string, keyValue: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(keyValue), 'AES-CBC', false, ['encrypt'])
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv: new TextEncoder().encode(WEAPI_IV) },
    key,
    new TextEncoder().encode(value),
  )
  return toBase64(new Uint8Array(encrypted))
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((byte) => SECRET_CHARACTERS[byte % SECRET_CHARACTERS.length]).join('')
}

function randomHex(length: number): string {
  return [...crypto.getRandomValues(new Uint8Array(length))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function readResponseCookies(headers: Headers): string[] {
  const values = headers.getSetCookie()
  return values.map((value) => value.split(';', 1)[0]).filter(Boolean)
}

function mergeCookies(current: string[], incoming: string[]): string[] {
  const values = new Map<string, string>()
  for (const cookie of [...current, ...incoming]) {
    const name = cookie.split('=', 1)[0]
    if (name) values.set(name, cookie)
  }
  return [...values.values()]
}

function toPlaylist(value: NeteasePlaylist): ImportedMusicPlaylist | null {
  if (!value.id || !value.name) return null
  return {
    externalId: String(value.id),
    title: value.name,
    description: value.description ?? null,
    coverUrl: value.coverImgUrl ?? null,
    ownerName: value.creator?.nickname ?? null,
    trackCount: value.trackCount ?? 0,
    remoteUpdatedAt: value.updateTime ? new Date(value.updateTime).toISOString() : null,
  }
}

function toTrack(value: NeteaseSong): ImportedMusicTrack | null {
  if (!value.id || !value.name) return null
  return {
    provider: 'netease',
    externalId: String(value.id),
    mediaKey: `netease:track:${value.id}`,
    title: value.name,
    artists: (value.ar ?? []).flatMap((artist) => (artist.name ? [artist.name] : [])),
    albumTitle: value.al?.name ?? null,
    albumExternalId: value.al?.id ? String(value.al.id) : null,
    albumArtists: [],
    albumReleaseDate: null,
    albumReleaseType: null,
    albumMetadataUpdatedAt: null,
    discNumber: positiveInteger(value.cd),
    trackNumber: positiveInteger(value.no),
    coverUrl: value.al?.picUrl ?? null,
    durationMs: value.dt ?? null,
    isrcs: [],
  }
}

function toAlbum(value: NeteaseAlbum | undefined): ImportedMusicAlbum | null {
  if (!value?.id || !value.name) return null
  const artists = (value.artists ?? []).flatMap((artist) => (artist.name ? [artist.name] : []))
  if (artists.length === 0 && value.artist?.name) artists.push(value.artist.name)
  return {
    externalId: String(value.id),
    title: value.name,
    artists,
    releaseDate: timestampDate(value.publishTime),
    releaseType: value.type?.trim() || value.subType?.trim() || null,
    coverUrl: value.picUrl ?? null,
  }
}

function timestampDate(value: number | undefined): string | null {
  if (!value || !Number.isFinite(value)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

function positiveInteger(value: string | number | undefined): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : null
  const match = value?.match(/\d+/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toBase64(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
}
