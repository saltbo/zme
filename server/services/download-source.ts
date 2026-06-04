export type DownloadSourceType = 'magnet' | 'torrent_url'

export interface DownloadSource {
  uri: string
  sourceType: DownloadSourceType
}

export async function resolveProwlarrProxyDownloadUrl(uri: string): Promise<DownloadSource | null> {
  let current = uri
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(current, {
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
    return url.pathname.endsWith('/download') && url.searchParams.has('apikey') && url.searchParams.has('link')
  } catch {
    return false
  }
}

function isRedirect(status: number) {
  return status >= 300 && status < 400
}
