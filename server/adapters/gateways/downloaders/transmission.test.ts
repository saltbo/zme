import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorConfig, DownloaderGateway } from '../../../usecases/ports'
import { jsonResponse, stubFetch } from './test-support'
import { transmissionDownloaderGateway } from './transmission'

const config: ConnectorConfig = {
  endpoint: 'http://tr.local',
  credentials: { username: 'admin', password: 'secret' },
  options: { downloadDir: '/data' },
}

const input: Parameters<DownloaderGateway['submit']>[1] = {
  downloaderId: 'dl-1',
  uri: 'http://indexer.local/file.torrent',
  sourceType: 'torrent_url',
  category: 'tv',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('transmissionDownloaderGateway', () => {
  it('retries with the session id after a 409 handshake and sends the typed download dir', async () => {
    const calls = stubFetch((_request, index) =>
      index === 0
        ? new Response(null, { status: 409, headers: { 'x-transmission-session-id': 'sess-1' } })
        : jsonResponse({ result: 'success' }),
    )

    await transmissionDownloaderGateway.submit(config, input)

    expect(calls).toHaveLength(2)
    expect(calls.every((call) => call.url.pathname === '/transmission/rpc')).toBe(true)
    expect(calls[0].headers.get('x-transmission-session-id')).toBeNull()
    expect(calls[1].headers.get('x-transmission-session-id')).toBe('sess-1')
    expect(calls[1].headers.get('authorization')).toBe(`Basic ${btoa('admin:secret')}`)

    expect(JSON.parse(calls[1].body ?? '')).toEqual({
      method: 'torrent-add',
      arguments: {
        filename: 'http://indexer.local/file.torrent',
        'download-dir': '/data/Series',
      },
    })
  })

  it('rejects when transmission reports a non-success result', async () => {
    stubFetch(() => jsonResponse({ result: 'duplicate torrent' }))

    await expect(transmissionDownloaderGateway.submit(config, input)).rejects.toThrow(
      'Transmission rejected download: duplicate torrent',
    )
  })

  it('fails when the 409 handshake carries no session id', async () => {
    stubFetch(() => new Response(null, { status: 409 }))

    await expect(transmissionDownloaderGateway.submit(config, input)).rejects.toThrow(
      'Transmission did not return a session id.',
    )
  })

  it('probes via session-get', async () => {
    const calls = stubFetch(() => jsonResponse({ result: 'success' }))

    await transmissionDownloaderGateway.probe(config)

    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0].body ?? '')).toEqual({ method: 'session-get' })
  })
})
