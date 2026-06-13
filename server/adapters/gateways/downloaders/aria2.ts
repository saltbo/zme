import type { DownloaderGateway } from '../../../usecases/ports'
import { assertOk, getTypedDownloadDirectory } from './shared'

export const aria2DownloaderGateway: DownloaderGateway = {
  async submit(config, input) {
    const params: unknown[] = [[input.uri]]
    if (config.credentials.secret) params.unshift(`token:${config.credentials.secret}`)
    const dir = getTypedDownloadDirectory(config.options.dir, input.category)
    if (dir) params.push({ dir })

    const response = await rpc(config.endpoint, 'aria2.addUri', params)
    await assertOk(response, 'aria2')
    const payload = (await response.json()) as { error?: { message?: string } }
    if (payload.error) throw new Error(`aria2 rejected download: ${payload.error.message || 'unknown error'}`)
  },

  async probe(config) {
    const params: unknown[] = []
    if (config.credentials.secret) params.push(`token:${config.credentials.secret}`)
    const response = await rpc(config.endpoint, 'aria2.getVersion', params)
    await assertOk(response, 'aria2')
  },
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
