import { getZmeDownloadResourceDirectory } from '@shared/download-metadata'

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

export function basicAuthHeader(username?: string, password?: string) {
  if (!username && !password) return null
  return `Basic ${btoa(`${username || ''}:${password || ''}`)}`
}

export function getTypedDownloadDirectory(rootDirectory: string | undefined, category: string | undefined) {
  const resourceDirectory = getZmeDownloadResourceDirectory(category)
  if (!resourceDirectory) return rootDirectory || ''
  if (!rootDirectory) return resourceDirectory
  return `${rootDirectory.replace(/[\\/]+$/, '')}/${resourceDirectory}`
}

export async function assertOk(response: Response, target: string) {
  if (response.ok) return
  const text = await response.text()
  throw new Error(`${target} request failed: ${response.status}${text ? ` ${text}` : ''}`)
}
