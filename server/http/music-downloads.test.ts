import { afterEach, describe, expect, it, vi } from 'vitest'
import { proxyMusicResource } from './music-downloads'

afterEach(() => vi.unstubAllGlobals())

describe('music download proxy', () => {
  it('streams range responses without exposing upstream headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('audio', {
        status: 206,
        headers: {
          'accept-ranges': 'bytes',
          'content-range': 'bytes 5-9/10',
          'content-length': '5',
          'content-type': 'audio/mpeg',
          'set-cookie': 'private=secret',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await proxyMusicResource(
      new Request('https://zme.test/api/music/tracks/track-1/download?key=secret', {
        headers: { Range: 'bytes=5-' },
      }),
      {
        url: 'https://m701.music.126.net/audio.mp3',
        headers: { Referer: 'https://music.163.com/' },
        extension: 'mp3',
        contentType: 'audio/mpeg',
        contentLength: 10,
      },
      'Artist - Track.mp3',
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://m701.music.126.net/audio.mp3',
      expect.objectContaining({ method: 'GET', headers: expect.any(Headers) }),
    )
    const upstreamHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers
    expect(upstreamHeaders.get('range')).toBe('bytes=5-')
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 5-9/10')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.text()).toBe('audio')
  })
})
