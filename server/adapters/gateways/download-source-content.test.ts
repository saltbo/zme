import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadSourceContentGateway } from './download-source-content'

afterEach(() => vi.unstubAllGlobals())

describe('torrent file proxy', () => {
  it('follows upstream redirects internally and returns only torrent bytes', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://tracker.test/signed?passkey=secret' } }),
      )
      .mockResolvedValueOnce(new Response('d4:infod4:name4:testee', { headers: { 'set-cookie': 'secret=value' } }))
    vi.stubGlobal('fetch', fetch)
    expect(new TextDecoder().decode(await downloadSourceContentGateway.torrent('https://prowlarr.test/file'))).toBe(
      'd4:infod4:name4:testee',
    )
    expect(fetch.mock.calls[1][0].toString()).toBe('https://tracker.test/signed?passkey=secret')
    expect(fetch.mock.calls.every(([, init]) => init.redirect === 'manual')).toBe(true)
  })

  it.each([
    { reason: 'an HTML login page', response: () => new Response('<html>Login required</html>') },
    { reason: 'an upstream failure', response: () => new Response('https://tracker.test/?secret', { status: 403 }) },
    {
      reason: 'an unsafe redirect scheme',
      response: () => new Response(null, { status: 302, headers: { location: 'file:///etc/passwd' } }),
    },
    { reason: 'a redirect loop', response: () => new Response(null, { status: 302, headers: { location: '/loop' } }) },
    { reason: 'oversized metadata', response: () => new Response(new Uint8Array(10 * 1024 * 1024 + 1)) },
  ])('rejects $reason', async ({ response }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response()),
    )
    await expect(downloadSourceContentGateway.torrent('https://tracker.test/file')).rejects.toThrow(
      'The torrent file could not be downloaded.',
    )
  })
})
