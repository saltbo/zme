import type { ConnectorConfig, DownloaderGateway } from '@server/usecases/ports'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { aria2DownloaderGateway } from './aria2'
import { jsonResponse, stubFetch } from './test-support'

const config: ConnectorConfig = {
  endpoint: 'http://aria2.local/jsonrpc',
  credentials: { secret: 's3cret' },
  options: { dir: '/dl' },
}

// Bare 'movie'/'tv' categories are normalized automatically; resource categories
// like music arrive already namespaced as 'zme:music'.
const input: Parameters<DownloaderGateway['submit']>[1] = {
  downloaderId: 'dl-1',
  uri: 'magnet:?xt=urn:btih:abc',
  sourceType: 'magnet',
  category: 'zme:music',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('aria2DownloaderGateway', () => {
  it('submits addUri with the token, uri, and typed directory', async () => {
    const calls = stubFetch(() => jsonResponse({ result: 'gid-1' }))

    await aria2DownloaderGateway.submit(config, input)

    expect(calls).toHaveLength(1)
    const payload = JSON.parse(calls[0].body ?? '')
    expect(payload.method).toBe('aria2.addUri')
    expect(payload.params).toEqual(['token:s3cret', ['magnet:?xt=urn:btih:abc'], { dir: '/dl/Music' }])
  })

  it('omits the token when no secret is configured', async () => {
    const calls = stubFetch(() => jsonResponse({ result: 'gid-1' }))

    await aria2DownloaderGateway.submit({ ...config, credentials: {} }, input)

    const payload = JSON.parse(calls[0].body ?? '')
    expect(payload.params[0]).toEqual(['magnet:?xt=urn:btih:abc'])
  })

  it('rejects when aria2 returns an error payload', async () => {
    stubFetch(() => jsonResponse({ error: { message: 'Unauthorized' } }))

    await expect(aria2DownloaderGateway.submit(config, input)).rejects.toThrow('aria2 rejected download: Unauthorized')
  })

  it('probes via getVersion with the token', async () => {
    const calls = stubFetch(() => jsonResponse({ result: { version: '1.37.0' } }))

    await aria2DownloaderGateway.probe(config)

    const payload = JSON.parse(calls[0].body ?? '')
    expect(payload.method).toBe('aria2.getVersion')
    expect(payload.params).toEqual(['token:s3cret'])
  })
})
