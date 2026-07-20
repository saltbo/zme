import { constants, createCipheriv, createHash, publicEncrypt } from 'node:crypto'
import type { ImportedMusicPlaylist, ImportedMusicTrack, MusicPlaylistConnector } from '@server/usecases/ports'

const NETEASE_BASE = 'https://music.163.com'
const NETEASE_INTERFACE_BASE = 'https://interface.music.163.com'
const WEAPI_IV = '0102030405060708'
const WEAPI_PRESET_KEY = '0CoJUm6Qyw8W8jud'
const EAPI_KEY = 'e82ckenh8dichen8'
const WEAPI_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`
const SECRET_CHARACTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

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
  ar?: Array<{ name?: string }>
  al?: { id?: number; name?: string; picUrl?: string }
}

interface NeteaseRiskData {
  verifyId?: string | number
  verifyType?: string | number
  verifyToken?: string
  params?: { event_id?: string; sign?: string } | string
}

export const neteasePlaylistConnector: MusicPlaylistConnector = {
  async beginQrLogin() {
    const response = await weapiRequest<{
      code?: number
      message?: string
      unikey?: string
      data?: { unikey?: string }
    }>('/weapi/login/qrcode/unikey', { type: 3 }, [])
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
    const response = await weapiRequest<{ code?: number }>(
      '/weapi/login/qrcode/client/login',
      { key, type: 3 },
      cookies,
    )
    const mergedCookies = mergeCookies(cookies, response.cookies)
    if (response.body.code === 800) return { status: 'expired', cookies: mergedCookies }
    if (response.body.code === 801) return { status: 'waiting_scan', cookies: mergedCookies }
    if (response.body.code === 802) return { status: 'waiting_confirmation', cookies: mergedCookies }
    if (response.body.code !== 803)
      throw new Error(`Netease QR login failed with code ${response.body.code ?? 'unknown'}.`)

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
      cookies,
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
    `deviceId=${readCookie(cookies, 'deviceId') ?? randomHex(16)}`,
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
  return {
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
}

function encryptEapi(path: string, data: Record<string, unknown>): string {
  const text = JSON.stringify(data)
  const digest = createHash('md5').update(`nobody${path}use${text}md5forencrypt`).digest('hex')
  const plaintext = `${path}-36cd479b6b5-${text}-36cd479b6b5-${digest}`
  const cipher = createCipheriv('aes-128-ecb', EAPI_KEY, null)
  return Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    .toString('hex')
    .toUpperCase()
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
    coverUrl: value.al?.picUrl ?? null,
    durationMs: value.dt ?? null,
    isrcs: [],
  }
}

function toBase64(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
}
