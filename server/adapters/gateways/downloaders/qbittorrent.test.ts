import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorConfig, DownloaderGateway } from '../../../usecases/ports'
import { qbittorrentDownloaderGateway } from './qbittorrent'
import { jsonResponse, stubFetch } from './test-support'

const config: ConnectorConfig = {
  endpoint: 'http://qb.local',
  credentials: { username: 'admin', password: 'secret' },
  options: { savePath: '/downloads' },
}

const input: Parameters<DownloaderGateway['submit']>[1] = {
  downloaderId: 'dl-1',
  uri: 'magnet:?xt=urn:btih:abc',
  sourceType: 'magnet',
  category: 'movie',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('qbittorrentDownloaderGateway', () => {
  it('logs in, then submits the torrent with the typed save path', async () => {
    const calls = stubFetch((_request, index) =>
      index === 0
        ? new Response('Ok.', { status: 200, headers: { 'set-cookie': 'SID=session-1' } })
        : jsonResponse('Ok.'),
    )

    await qbittorrentDownloaderGateway.submit(config, input)

    expect(calls.map((call) => `${call.method} ${call.url.pathname}`)).toEqual([
      'POST /api/v2/auth/login',
      'POST /api/v2/torrents/add',
    ])

    const login = new URLSearchParams(calls[0].body ?? '')
    expect(login.get('username')).toBe('admin')
    expect(login.get('password')).toBe('secret')

    expect(calls[1].headers.get('cookie')).toBe('SID=session-1')
    expect(calls[1].body).toContain('magnet:?xt=urn:btih:abc')
    expect(calls[1].body).toContain('/downloads/Movies')
  })

  it('fails fast when login returns no session cookie', async () => {
    stubFetch(() => new Response('Ok.', { status: 200 }))

    await expect(qbittorrentDownloaderGateway.submit(config, input)).rejects.toThrow(
      'qBittorrent did not return a session cookie.',
    )
  })

  it('surfaces submission rejections with status and body', async () => {
    stubFetch((_request, index) =>
      index === 0
        ? new Response('Ok.', { status: 200, headers: { 'set-cookie': 'SID=session-1' } })
        : new Response('Fails.', { status: 415 }),
    )

    await expect(qbittorrentDownloaderGateway.submit(config, input)).rejects.toThrow(
      'qBittorrent request failed: 415 Fails.',
    )
  })

  it('probes by logging in', async () => {
    const calls = stubFetch(() => new Response('Ok.', { status: 200, headers: { 'set-cookie': 'SID=s' } }))

    await qbittorrentDownloaderGateway.probe(config)

    expect(calls).toHaveLength(1)
    expect(calls[0].url.pathname).toBe('/api/v2/auth/login')
  })
})
