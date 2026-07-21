import { afterEach, describe, expect, it, vi } from 'vitest'
import { neteaseMusicResourceResolver, neteasePlaylistConnector } from './netease'

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

  it('keeps playlist metadata sync separate from batched availability checks', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ playlist: { trackIds: [{ id: 123 }, { id: 456 }] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            songs: [
              { id: 123, name: 'Available', ar: [{ name: 'Artist' }], al: { id: 1, name: 'Album' } },
              { id: 456, name: 'Unavailable', ar: [{ name: 'Artist' }], al: { id: 1, name: 'Album' } },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 200,
            data: [
              {
                id: 123,
                url: 'https://m701.music.126.net/audio.mp3',
                type: 'mp3',
                level: 'exhigh',
                code: 200,
                freeTrialInfo: null,
              },
              { id: 456, url: null, type: null, level: 'standard', code: 404, freeTrialInfo: null, fee: 1, payed: 0 },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = await neteasePlaylistConnector.listTracks(['MUSIC_U=session-value'], 'playlist-1')
    const availability = await neteasePlaylistConnector.checkTrackAvailability(
      ['MUSIC_U=session-value'],
      ['123', '456'],
    )

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ externalId: '123' })
    expect(result[1]).toMatchObject({ externalId: '456' })
    expect(availability.results).toEqual(
      new Map([
        [
          '123',
          {
            status: 'available',
            reason: null,
            providerCode: '200',
            providerDetails: { level: 'exhigh', freeTrial: false },
          },
        ],
        [
          '456',
          {
            status: 'unavailable',
            reason: 'membership_required',
            providerCode: '404',
            providerDetails: { fee: 1, payed: 0, level: 'standard', freeTrial: false },
          },
        ],
      ]),
    )
    expect(availability.interrupted).toBeNull()
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://interface.music.163.com/eapi/song/enhance/player/url/v1',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('stops later availability batches after an upstream risk response', async () => {
    const trackIds = Array.from({ length: 201 }, (_, index) => String(index + 1))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 200,
            data: trackIds.slice(0, 100).map((id) => ({
              id: Number(id),
              url: `https://m701.music.126.net/${id}.mp3`,
              type: 'mp3',
              level: 'standard',
              code: 200,
              freeTrialInfo: null,
            })),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await neteasePlaylistConnector.checkTrackAvailability(['MUSIC_U=session-value'], trackIds)

    expect(result.results.size).toBe(100)
    expect(result.interrupted).toEqual({
      reason: 'rate_limited',
      providerCode: '429',
      message: 'Netease request failed: 429',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('Netease music resource resolver', () => {
  it('resolves an entitled track through the authenticated EAPI', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          data: [
            {
              id: 123,
              url: 'http://m701.music.126.net/audio.mp3',
              type: 'mp3',
              size: 4096,
              level: 'exhigh',
              code: 200,
              freeTrialInfo: null,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      neteaseMusicResourceResolver.resolve(['MUSIC_U=session-value'], { trackId: '123', quality: 'exhigh' }),
    ).resolves.toEqual({
      url: 'https://m701.music.126.net/audio.mp3',
      headers: {
        Referer: 'https://music.163.com/',
        'User-Agent': 'Mozilla/5.0 ZME/0.0.1',
      },
      quality: 'exhigh',
      extension: 'mp3',
      contentType: 'audio/mpeg',
      contentLength: 4096,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://interface.music.163.com/eapi/song/enhance/player/url/v1',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Cookie: expect.stringContaining('MUSIC_U=session-value') }),
      }),
    )
  })

  it('rejects preview-only tracks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 200,
            data: [
              {
                id: 123,
                url: 'https://m701.music.126.net/preview.mp3',
                type: 'mp3',
                level: 'exhigh',
                code: 200,
                freeTrialInfo: { start: 0, end: 30 },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )

    await expect(
      neteaseMusicResourceResolver.resolve(['MUSIC_U=session-value'], { trackId: '123', quality: 'exhigh' }),
    ).rejects.toThrow('Netease only returned a trial preview for this track.')
  })
})
