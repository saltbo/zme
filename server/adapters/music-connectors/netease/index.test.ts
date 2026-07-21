import { afterEach, describe, expect, it, vi } from 'vitest'
import { neteaseMusicConnector } from '.'

const neteaseAuth = neteaseMusicConnector.auth

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

    const result = await neteaseAuth.start({ method: 'qr', input: {} })

    expect(result).toMatchObject({
      status: 'pending',
      state: { phase: 'qr_login', key: 'qr-key-1' },
      challenge: { type: 'qr', url: 'https://music.163.com/login?codekey=qr-key-1' },
    })
    if (result.status !== 'pending') throw new Error('Expected a pending login.')
    expect(result.state).toMatchObject({
      cookies: expect.arrayContaining(['NMTID=cookie-value', 'os=pc', 'appver=3.1.17.204416']),
    })
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
      neteaseAuth.continue(
        {
          phase: 'qr_login',
          key: 'qr-key-1',
          expiresAt: '2099-07-20T01:00:00.000Z',
          cookies: [
            'deviceId=device-1',
            'NMTID=cookie-value',
            'MUSIC_A=anonymous-session',
            'os=pc',
            'appver=3.1.17.204416',
          ],
        },
        { action: 'poll', input: {} },
      ),
    ).resolves.toMatchObject({
      status: 'pending',
      state: { phase: 'qr_login' },
      challenge: { type: 'qr', progress: 'waiting_scan' },
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

    const result = await neteaseAuth.continue(
      {
        phase: 'qr_login',
        key: 'qr-key-1',
        cookies: ['MUSIC_A=anonymous-session'],
        expiresAt: '2099-07-20T01:00:00.000Z',
      },
      { action: 'poll', input: {} },
    )

    expect(result).toMatchObject({
      status: 'pending',
      state: { phase: 'verification', qrCode: 'risk-qr-code', resume: { method: 'qr', key: 'qr-key-1' } },
      challenge: { type: 'qr', purpose: 'verification' },
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

    await expect(
      neteaseAuth.start({ method: 'sms', input: { countryCode: '86', phone: '13800138000' } }),
    ).resolves.toMatchObject({
      status: 'pending',
      state: { phase: 'sms_code', countryCode: '86', phone: '13800138000' },
      challenge: { type: 'form', action: 'submit_code' },
    })
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

    const result = await neteaseAuth.continue(
      {
        phase: 'sms_code',
        countryCode: '86',
        phone: '13800138000',
        cookies: ['MUSIC_A=anonymous-session'],
        expiresAt: '2099-07-20T01:00:00.000Z',
      },
      { action: 'submit_code', input: { code: '1234' } },
    )
    expect(result).toMatchObject({
      status: 'connected',
      account: {
        externalAccountId: '42',
        displayName: 'Music Fan',
        avatarUrl: 'https://img.test/42.jpg',
      },
    })
    if (result.status !== 'connected') throw new Error('Expected a connected login.')
    expect(result.credentials).toEqual(expect.arrayContaining(['MUSIC_U=session-value', '__csrf=csrf-value']))
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

    const result = await neteaseAuth.continue(
      {
        phase: 'sms_code',
        countryCode: '86',
        phone: '13800138000',
        cookies: ['MUSIC_A=anonymous-session'],
        expiresAt: '2099-07-20T01:00:00.000Z',
      },
      { action: 'submit_code', input: { code: '1234' } },
    )

    expect(result).toMatchObject({
      status: 'pending',
      state: { phase: 'verification', qrCode: 'risk-qr-code', resume: { method: 'sms' } },
      challenge: { type: 'qr', purpose: 'verification' },
    })
    if (result.status !== 'pending' || result.challenge.type !== 'qr') {
      throw new Error('Expected a verification challenge.')
    }
    expect(result.challenge.url).toContain('qrCode=risk-qr-code')
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://music.163.com/weapi/frontrisk/verify/getqrcode',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('resumes the original login after account verification completes', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ code: 200, data: { qrCodeStatus: 20, detailReason: 0 } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ code: 200 }), {
            status: 200,
            headers: { 'content-type': 'application/json', 'set-cookie': 'MUSIC_U=session-value; Path=/' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ profile: { userId: 42, nickname: 'Music Fan' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
    )

    await expect(
      neteaseAuth.continue(
        {
          phase: 'verification',
          qrCode: 'risk-qr-code',
          qrUrl: 'https://st.music.163.com/encrypt-pages?qrCode=risk-qr-code',
          cookies: ['deviceId=device-1', 'MUSIC_A=anonymous-session'],
          expiresAt: '2099-07-20T01:00:00.000Z',
          resume: { method: 'sms', countryCode: '86', phone: '13800138000', code: '1234' },
        },
        { action: 'poll', input: {} },
      ),
    ).resolves.toMatchObject({ status: 'connected', account: { externalAccountId: '42' } })
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

    await expect(
      neteaseAuth.start({ method: 'sms', input: { countryCode: '86', phone: '13800138000' } }),
    ).rejects.toThrow('Netease failed to send the SMS code (code 503: Verification attempts exceeded).')
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
              { id: 123, name: 'Available', no: 7, cd: '02', ar: [{ name: 'Artist' }], al: { id: 1, name: 'Album' } },
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

    const session = neteaseMusicConnector.open(['MUSIC_U=session-value'])
    const result = await session.listTracks('playlist-1')
    const availability = await session.checkTrackAvailability(['123', '456'])

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ externalId: '123', release: { discNumber: 2, trackNumber: 7 } })
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

  it('loads canonical album metadata for directory organization', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          album: {
            id: 34888233,
            name: '翁梓铭',
            type: '专辑',
            publishTime: Date.UTC(2016, 8, 19),
            picUrl: 'https://p1.music.126.net/album.jpg',
            artist: { name: '翁梓铭' },
            artists: [{ name: '翁梓铭' }],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(neteaseMusicConnector.open(['MUSIC_U=session-value']).getReleases(['34888233'])).resolves.toEqual([
      {
        externalId: '34888233',
        title: '翁梓铭',
        artists: ['翁梓铭'],
        releaseDate: '2016-09-19',
        releaseType: 'album',
        providerReleaseType: '专辑',
        coverUrl: 'https://p1.music.126.net/album.jpg',
      },
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://music.163.com/weapi/v1/album/34888233',
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

    const result = await neteaseMusicConnector.open(['MUSIC_U=session-value']).checkTrackAvailability(trackIds)

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
      neteaseMusicConnector.open(['MUSIC_U=session-value']).resolve({ trackId: '123', quality: 'exhigh' }),
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
      neteaseMusicConnector.open(['MUSIC_U=session-value']).resolve({ trackId: '123', quality: 'exhigh' }),
    ).rejects.toThrow('Netease only returned a trial preview for this track.')
  })
})
