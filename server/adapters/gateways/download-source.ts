export type DownloadSourceType = 'magnet' | 'torrent_url'

export interface DownloadSource {
  uri: string
  sourceType: DownloadSourceType
}

const resolveTimeoutMs = 30_000

export async function resolveProwlarrProxyDownloadUrl(uri: string): Promise<DownloadSource | null> {
  let current = uri
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetchWithTimeout(current, {
      method: 'GET',
      redirect: 'manual',
    })

    if (!isRedirect(response.status)) {
      const detail = await readResponseDetail(response)
      throw new Error(
        `Prowlarr download URL returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}${detail ? `: ${detail}` : ''}; expected a redirect.`,
      )
    }

    const location = response.headers.get('location')
    if (!location) {
      throw new Error(`Prowlarr download URL returned HTTP ${response.status} without a Location header.`)
    }
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

export function applyProwlarrBaseUrl(value: string, baseUrl: string) {
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
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Prowlarr download URL timed out after ${resolveTimeoutMs / 1000} seconds.`, { cause: error })
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function isRedirect(status: number) {
  return status >= 300 && status < 400
}

async function readResponseDetail(response: Response) {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]
  if (!contentType) return null
  if (contentType !== 'application/json' && !contentType.startsWith('text/')) return contentType

  const body = (await response.text()).replace(/\s+/g, ' ').trim()
  if (!body) return contentType
  return `${contentType} ${body.slice(0, 500)}`
}
