import type { MusicFileCover } from './types.ts'

export const MAX_EMBEDDED_MUSIC_COVER_BYTES = 64 * 1024

const NETEASE_COVER_DIMENSIONS = [600, 500, 400, 300, 200, 130]
const MAX_NETEASE_COVER_REDIRECTS = 3

export async function fetchNeteaseMusicCover(value: string): Promise<MusicFileCover> {
  for (const dimension of NETEASE_COVER_DIMENSIONS) {
    const response = await fetchNeteaseCover(resizeNeteaseCoverUrl(value, dimension))
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Music cover returned HTTP ${response.status}.`)
    }

    const declaredLength = parseContentLength(response.headers.get('content-length'))
    if (declaredLength !== null && declaredLength > MAX_EMBEDDED_MUSIC_COVER_BYTES) {
      await response.body?.cancel()
      continue
    }

    const bytes = await readResponseBytes(response, MAX_EMBEDDED_MUSIC_COVER_BYTES)
    if (!bytes) continue
    return { mimeType: detectCoverMimeType(bytes), bytes }
  }

  throw new Error(`Netease cover exceeds ${MAX_EMBEDDED_MUSIC_COVER_BYTES} bytes at every supported size.`)
}

async function fetchNeteaseCover(initialUrl: URL): Promise<Response> {
  let url = initialUrl
  for (let redirects = 0; ; redirects += 1) {
    const response = await fetch(url, {
      headers: {
        Referer: 'https://music.163.com/',
        'User-Agent': 'Mozilla/5.0 ZME/0.0.1',
      },
      redirect: 'manual',
    })
    if (response.status < 300 || response.status >= 400) return response

    const location = response.headers.get('location')
    await response.body?.cancel()
    if (!location) throw new Error(`Music cover redirect returned HTTP ${response.status} without a location.`)
    if (redirects >= MAX_NETEASE_COVER_REDIRECTS) {
      throw new Error(`Music cover exceeded ${MAX_NETEASE_COVER_REDIRECTS} redirects.`)
    }
    url = normalizeNeteaseCoverUrl(new URL(location, url).toString())
  }
}

function resizeNeteaseCoverUrl(value: string, dimension: number): URL {
  const url = normalizeNeteaseCoverUrl(value)
  url.searchParams.set('param', `${dimension}y${dimension}`)
  return url
}

function normalizeNeteaseCoverUrl(value: string): URL {
  const url = new URL(value)
  const hostname = url.hostname.toLowerCase()
  const trustedHost =
    hostname === 'music.126.net' ||
    hostname.endsWith('.music.126.net') ||
    hostname === 'music.163.com' ||
    hostname.endsWith('.music.163.com')
  if (!trustedHost || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new Error('Netease returned an untrusted cover URL.')
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new Error('Netease returned an untrusted cover URL.')
  }
  url.protocol = 'https:'
  url.port = ''
  url.username = ''
  url.password = ''
  return url
}

async function readResponseBytes(response: Response, limit: number): Promise<Uint8Array | null> {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0

  while (true) {
    const next = await reader.read()
    if (next.done) return concatBytes(chunks, length)
    length += next.value.byteLength
    if (length > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(next.value)
  }
}

function concatBytes(chunks: Uint8Array[], length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function parseContentLength(value: string | null): number | null {
  if (value === null) return null
  const length = Number(value)
  return Number.isSafeInteger(length) && length >= 0 ? length : null
}

function detectCoverMimeType(bytes: Uint8Array): MusicFileCover['mimeType'] {
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  throw new Error('Music cover is not a supported JPEG, PNG, or WebP image.')
}
