import type { DownloaderGateway } from '@server/usecases/ports'
import { assertOk, basicAuthHeader, getTypedDownloadDirectory, normalizeBaseUrl } from './shared'

export const transmissionDownloaderGateway: DownloaderGateway = {
  async submit(config, input) {
    const endpoint = new URL('/transmission/rpc', normalizeBaseUrl(config.endpoint))
    const downloadDir = getTypedDownloadDirectory(config.options.downloadDir, input.category)
    const body = {
      method: 'torrent-add',
      arguments: {
        filename: input.uri,
        ...(downloadDir ? { 'download-dir': downloadDir } : {}),
      },
    }

    const response = await requestWithSession(endpoint, config.credentials, body)
    await assertOk(response, 'Transmission')
    const payload = (await response.json()) as { result?: string }
    if (payload.result && payload.result !== 'success') {
      throw new Error(`Transmission rejected download: ${payload.result}`)
    }
  },

  async probe(config) {
    const endpoint = new URL('/transmission/rpc', normalizeBaseUrl(config.endpoint))
    const response = await requestWithSession(endpoint, config.credentials, { method: 'session-get' })
    await assertOk(response, 'Transmission')
  },
}

async function requestWithSession(endpoint: URL, credentials: Record<string, string>, body: unknown) {
  let response = await request(endpoint, credentials, body)
  if (response.status === 409) {
    const session = response.headers.get('x-transmission-session-id')
    if (!session) throw new Error('Transmission did not return a session id.')
    response = await request(endpoint, credentials, body, session)
  }
  return response
}

function request(endpoint: URL, credentials: Record<string, string>, body: unknown, session?: string) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (session) headers.set('x-transmission-session-id', session)
  const authorization = basicAuthHeader(credentials.username, credentials.password)
  if (authorization) headers.set('authorization', authorization)

  return fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}
