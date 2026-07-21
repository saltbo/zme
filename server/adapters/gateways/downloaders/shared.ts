import { getZmeDownloadResourceDirectory, isValidDownloadSubdirectory } from '@shared/download-metadata'

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

export function basicAuthHeader(username?: string, password?: string) {
  if (!username && !password) return null
  return `Basic ${btoa(`${username || ''}:${password || ''}`)}`
}

export function getTypedDownloadDirectory(
  rootDirectory: string | undefined,
  category: string | undefined,
  targetSubdirectory?: string,
) {
  const resourceDirectory = getZmeDownloadResourceDirectory(category)
  const typedDirectory = resourceDirectory
    ? [rootDirectory?.replace(/[\\/]+$/, ''), resourceDirectory].filter(Boolean).join('/')
    : rootDirectory || ''
  if (!targetSubdirectory) return typedDirectory
  if (!isValidDownloadSubdirectory(targetSubdirectory)) throw new Error('Download subdirectory is invalid.')
  return [typedDirectory.replace(/[\\/]+$/, ''), targetSubdirectory].filter(Boolean).join('/')
}

export async function assertOk(response: Response, target: string) {
  if (response.ok) return
  const text = await response.text()
  throw new Error(`${target} request failed: ${response.status}${text ? ` ${text}` : ''}`)
}
