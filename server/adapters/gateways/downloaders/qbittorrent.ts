import type { DownloaderGateway } from '../../../usecases/ports'
import { assertOk, getTypedDownloadDirectory, normalizeBaseUrl } from './shared'

export const qbittorrentDownloaderGateway: DownloaderGateway = {
  async submit(config, input) {
    const baseUrl = normalizeBaseUrl(config.endpoint)
    const cookie = await login(baseUrl, config.credentials)
    const form = new FormData()
    form.set('urls', input.uri)
    const savePath = getTypedDownloadDirectory(config.options.savePath || config.options.category, input.category)
    if (savePath) form.set('savepath', savePath)

    const response = await fetch(new URL('/api/v2/torrents/add', baseUrl), {
      method: 'POST',
      headers: { cookie },
      body: form,
    })

    await assertOk(response, 'qBittorrent')
  },

  async probe(config) {
    await login(normalizeBaseUrl(config.endpoint), config.credentials)
  },
}

async function login(baseUrl: string, credentials: Record<string, string>) {
  const form = new URLSearchParams()
  form.set('username', credentials.username || '')
  form.set('password', credentials.password || '')
  const response = await fetch(new URL('/api/v2/auth/login', baseUrl), {
    method: 'POST',
    body: form,
  })

  await assertOk(response, 'qBittorrent')
  const cookie = response.headers.get('set-cookie')
  if (!cookie) throw new Error('qBittorrent did not return a session cookie.')
  return cookie
}
