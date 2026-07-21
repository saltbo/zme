import {
  decryptXeapiPublicKey,
  decryptXeapiResponse,
  encodeAnonymousUsername,
  encryptEapi,
  encryptWeapi,
  encryptXeapi,
  randomDeviceId,
  randomDigits,
  randomHex,
  signXeapi,
} from './crypto'
import type { XeapiPublicKey } from './types'

export const NETEASE_BASE = 'https://music.163.com'
const NETEASE_INTERFACE_BASE = 'https://interface.music.163.com'
const XEAPI_BASE = 'https://interface3.music.163.com'

export async function weapiRequest<T>(path: string, data: Record<string, unknown>, cookies: string[]) {
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

export async function eapiRequest<T>(path: string, data: Record<string, unknown>, cookies: string[]) {
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

export async function ensureAnonymousSession(cookies: string[]): Promise<string[]> {
  if (readCookie(cookies, 'MUSIC_A')) return cookies

  const deviceId = readCookie(cookies, 'deviceId') ?? randomDeviceId()
  const publicKey = await fetchXeapiPublicKey(deviceId)
  const response = await xeapiRequest<{ code?: number; message?: string }>(
    '/api/register/anonimous',
    { username: encodeAnonymousUsername(deviceId) },
    deviceId,
    publicKey,
  )
  const sessionCookies = mergeCookies(cookies, [`deviceId=${deviceId}`, ...response.cookies])
  if (response.body.code !== 200 || !readCookie(sessionCookies, 'MUSIC_A')) {
    throw new Error(neteaseError('Netease anonymous device registration failed', response.body))
  }
  return sessionCookies
}

export function mergeCookies(current: string[], incoming: string[]): string[] {
  const values = new Map<string, string>()
  for (const cookie of [...current, ...incoming]) {
    const name = cookie.split('=', 1)[0]
    if (name) values.set(name, cookie)
  }
  return [...values.values()]
}

export function neteaseError(prefix: string, response: { code?: number; message?: string }): string {
  return `${prefix} (code ${response.code ?? 'unknown'}${response.message ? `: ${response.message}` : ''}).`
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
  const publicKey = JSON.parse(decryptXeapiPublicKey(data.encryptedData)) as Partial<XeapiPublicKey>
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
  return {
    body: JSON.parse(decryptXeapiResponse(await response.arrayBuffer())) as T,
    cookies: readResponseCookies(response.headers),
  }
}

function readCookie(cookies: string[], name: string): string | null {
  const prefix = `${name}=`
  const value = cookies.find((cookie) => cookie.startsWith(prefix))
  return value ? value.slice(prefix.length) : null
}

function readResponseCookies(headers: Headers): string[] {
  return headers
    .getSetCookie()
    .map((value) => value.split(';', 1)[0])
    .filter(Boolean)
}
