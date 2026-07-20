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

  it('sends an SMS verification code', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 200 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(neteasePlaylistConnector.sendSmsCode({ countryCode: '86', phone: '13800138000' })).resolves.toBe(
      undefined,
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://music.163.com/weapi/sms/captcha/sent',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('logs in with an SMS code and returns the authenticated account session', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 200 }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'set-cookie': 'MUSIC_U=session-value; Path=/' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ profile: { userId: 42, nickname: 'Music Fan', avatarUrl: 'https://img.test/42.jpg' } }),
          {
            status: 200,
            headers: { 'content-type': 'application/json', 'set-cookie': '__csrf=csrf-value; Path=/' },
          },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      neteasePlaylistConnector.loginWithSms({ countryCode: '86', phone: '13800138000', code: '1234' }),
    ).resolves.toEqual({
      cookies: ['MUSIC_U=session-value', '__csrf=csrf-value'],
      account: {
        externalAccountId: '42',
        displayName: 'Music Fan',
        avatarUrl: 'https://img.test/42.jpg',
      },
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://music.163.com/weapi/w/login/cellphone',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://music.163.com/weapi/w/nuser/account/get',
      expect.objectContaining({ headers: expect.objectContaining({ Cookie: 'MUSIC_U=session-value' }) }),
    )
  })

  it('surfaces Netease SMS errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 503, message: 'Verification attempts exceeded' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    await expect(neteasePlaylistConnector.sendSmsCode({ countryCode: '86', phone: '13800138000' })).rejects.toThrow(
      'Netease failed to send the SMS code (code 503: Verification attempts exceeded).',
    )
  })
})
