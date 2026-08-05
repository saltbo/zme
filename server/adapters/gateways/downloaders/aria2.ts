import { type DownloaderGateway, DownloadSubmissionRejectedError } from '@server/usecases/ports'
import { assertOk, getTypedDownloadDirectory } from './shared'

export const aria2DownloaderGateway: DownloaderGateway = {
  supportedSourceTypes: ['http', 'magnet', 'torrent_url'],
  async submit(config, input, idempotencyKey) {
    const params: unknown[] = [[input.uri]]
    if (config.credentials.secret) params.unshift(`token:${config.credentials.secret}`)
    const dir = getTypedDownloadDirectory(config.options.dir, input.category, input.targetSubdirectory)
    const options: Record<string, string> = {}
    if (dir) options.dir = dir
    if (idempotencyKey) options.gid = await aria2Gid(idempotencyKey)
    if (Object.keys(options).length > 0) params.push(options)

    const response = await rpc(config.endpoint, 'aria2.addUri', params)
    await assertOk(response, 'aria2', true)
    const payload = (await response.json()) as { result?: string; error?: { message?: string } }
    if (payload.error)
      throw new DownloadSubmissionRejectedError(`aria2 rejected download: ${payload.error.message || 'unknown error'}`)
    return { externalTaskId: payload.result ?? null }
  },

  async probe(config) {
    const params: unknown[] = []
    if (config.credentials.secret) params.push(`token:${config.credentials.secret}`)
    const response = await rpc(config.endpoint, 'aria2.getVersion', params)
    await assertOk(response, 'aria2')
  },
}

async function aria2Gid(idempotencyKey: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(idempotencyKey)))
  return [...bytes.slice(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function rpc(endpoint: string, method: string, params: unknown[]) {
  return fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method,
      params,
    }),
  })
}
