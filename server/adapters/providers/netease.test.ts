import { afterEach, describe, expect, it, vi } from 'vitest'
import { neteasePlaylistConnector } from './netease'

afterEach(() => vi.unstubAllGlobals())

describe('Netease playlist connector', () => {
  it('starts QR login from the raw WEAPI response shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 200, unikey: 'qr-key-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'set-cookie': 'NMTID=cookie-value; Path=/' },
        }),
      ),
    )

    const result = await neteasePlaylistConnector.beginQrLogin()

    expect(result).toMatchObject({
      key: 'qr-key-1',
      qrUrl: 'https://music.163.com/login?codekey=qr-key-1',
    })
    expect(result.cookies).toContain('NMTID=cookie-value')
  })

  it('maps an unscanned QR code to waiting_scan', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 801 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    await expect(neteasePlaylistConnector.checkQrLogin('qr-key-1', ['NMTID=cookie-value'])).resolves.toEqual({
      status: 'waiting_scan',
      cookies: ['NMTID=cookie-value'],
    })
  })
})
