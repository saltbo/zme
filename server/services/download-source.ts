export type DownloadSourceType = 'magnet' | 'torrent_url'

export interface DownloadSource {
  uri: string
  sourceType: DownloadSourceType
}

const resolveTimeoutMs = 5000

export async function resolveProwlarrProxyDownloadUrl(uri: string): Promise<DownloadSource | null> {
  let current = uri
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetchWithTimeout(current, {
      method: 'GET',
      redirect: 'manual',
    })

    if (!isRedirect(response.status)) return null

    const location = response.headers.get('location')
    if (!location) return null
    if (location.startsWith('magnet:')) return { uri: location, sourceType: 'magnet' }

    current = new URL(location, current).toString()
    if (!isProwlarrProxyDownloadUrl(current)) return { uri: current, sourceType: 'torrent_url' }
  }

  throw new Error('Prowlarr download URL redirected too many times.')
}

export function isProwlarrProxyDownloadUrl(value: string) {
  try {
    const url = new URL(value)
    return url.pathname.endsWith('/download') && url.searchParams.has('link')
  } catch {
    return false
  }
}

export function useProwlarrBaseUrl(value: string, baseUrl: string) {
  const url = new URL(value)
  const base = new URL(baseUrl)
  url.protocol = base.protocol
  url.hostname = base.hostname
  url.port = base.port
  return url.toString()
}

export function stripProwlarrApiKey(value: string) {
  const url = new URL(value)
  url.searchParams.delete('apikey')
  return url.toString()
}

export function withProwlarrApiKey(value: string, apiKey: string) {
  const url = new URL(value)
  url.searchParams.set('apikey', apiKey)
  return url.toString()
}

async function fetchWithTimeout(input: string, init: RequestInit) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), resolveTimeoutMs)
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

function isRedirect(status: number) {
  return status >= 300 && status < 400
}
