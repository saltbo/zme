import { afterEach, describe, expect, it, vi } from 'vitest'
import { neteasePlaylistConnector } from './netease'

afterEach(() => vi.unstubAllGlobals())

describe('Netease playlist connector', () => {
  it('starts QR login from the raw EAPI response shape', async () => {
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
    expect(result.cookies).toEqual(expect.arrayContaining(['NMTID=cookie-value', 'os=pc', 'appver=3.1.17.204416']))
    expect(fetch).toHaveBeenCalledWith(
      'https://interface.music.163.com/eapi/login/qrcode/unikey',
      expect.objectContaining({ method: 'POST' }),
    )
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

    await expect(
      neteasePlaylistConnector.checkQrLogin('qr-key-1', [
        'deviceId=device-1',
        'NMTID=cookie-value',
        'MUSIC_A=anonymous-session',
        'os=pc',
        'appver=3.1.17.204416',
      ]),
    ).resolves.toEqual({
      status: 'waiting_scan',
      cookies: [
        'deviceId=device-1',
        'NMTID=cookie-value',
        'MUSIC_A=anonymous-session',
        'os=pc',
        'appver=3.1.17.204416',
      ],
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://interface.music.163.com/eapi/login/qrcode/client/login',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('turns QR login risk into an account verification challenge', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: -462,
            data: {
              verifyId: 2001,
              verifyType: 40,
              verifyToken: 'risk-token',
              params: { event_id: 'event-1', sign: 'risk-sign' },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 200, data: { qrCode: 'risk-qr-code' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await neteasePlaylistConnector.checkQrLogin('qr-key-1', ['MUSIC_A=anonymous-session'])

    expect(result).toMatchObject({
      status: 'verification_required',
      verification: { qrCode: 'risk-qr-code' },
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

    const result = await neteasePlaylistConnector.loginWithSms(
      { countryCode: '86', phone: '13800138000', code: '1234' },
      ['MUSIC_A=anonymous-session'],
    )
    expect(result).toMatchObject({
      status: 'connected',
      account: {
        externalAccountId: '42',
        displayName: 'Music Fan',
        avatarUrl: 'https://img.test/42.jpg',
      },
    })
    expect(result.cookies).toEqual(expect.arrayContaining(['MUSIC_U=session-value', '__csrf=csrf-value']))
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://interface.music.163.com/eapi/w/login/cellphone',
      expect.objectContaining({ method: 'POST' }),
    )
    const loginRequest = fetchMock.mock.calls[0]?.[1] as RequestInit
    const loginBody = new URLSearchParams(loginRequest.body as string)
    expect(loginBody.get('params')).toMatch(/^[0-9A-F]+$/)
    expect(loginBody.has('encSecKey')).toBe(false)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://music.163.com/weapi/w/nuser/account/get',
      expect.objectContaining({
        headers: expect.objectContaining({ Cookie: expect.stringContaining('MUSIC_U=session-value') }),
      }),
    )
  })

  it('turns a login risk response into an account verification QR challenge', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: -462,
            data: {
              verifyId: 2001,
              verifyType: 40,
              verifyToken: 'risk-token',
              params: { event_id: 'event-1', sign: 'risk-sign' },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 200, data: { qrCode: 'risk-qr-code' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await neteasePlaylistConnector.loginWithSms(
      { countryCode: '86', phone: '13800138000', code: '1234' },
      ['MUSIC_A=anonymous-session'],
    )

    expect(result).toMatchObject({
      status: 'verification_required',
      verification: { qrCode: 'risk-qr-code' },
    })
    if (result.status !== 'verification_required') throw new Error('Expected a verification challenge.')
    expect(result.verification.qrUrl).toContain('qrCode=risk-qr-code')
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://music.163.com/weapi/frontrisk/verify/getqrcode',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('maps a completed account verification QR status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 200, data: { qrCodeStatus: 20, detailReason: 0 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    await expect(
      neteasePlaylistConnector.checkRiskVerification('risk-qr-code', ['deviceId=device-1']),
    ).resolves.toEqual({
      status: 'connected',
      cookies: ['deviceId=device-1'],
    })
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
