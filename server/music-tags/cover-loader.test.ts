import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchNeteaseMusicCover, MAX_EMBEDDED_MUSIC_COVER_BYTES } from './cover-loader'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Netease music cover loader', () => {
  it('selects the largest resized cover that fits the WebDAV byte budget', async () => {
    const cover = jpegCover()
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(new Uint8Array(), {
          headers: { 'Content-Length': String(MAX_EMBEDDED_MUSIC_COVER_BYTES + 1) },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array(cover), {
          headers: { 'Content-Length': String(cover.byteLength), 'Content-Type': 'image/jpeg' },
        }),
      )

    const result = await fetchNeteaseMusicCover('http://p3.music.126.net/album.jpg?param=2480y2480')

    expect(result).toEqual({ mimeType: 'image/jpeg', bytes: cover })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy).toHaveBeenNthCalledWith(1, new URL('https://p3.music.126.net/album.jpg?param=600y600'), {
      headers: {
        Referer: 'https://music.163.com/',
        'User-Agent': 'Mozilla/5.0 ZME/0.0.1',
      },
      redirect: 'manual',
    })
    expect(fetchSpy).toHaveBeenNthCalledWith(2, new URL('https://p3.music.126.net/album.jpg?param=500y500'), {
      headers: {
        Referer: 'https://music.163.com/',
        'User-Agent': 'Mozilla/5.0 ZME/0.0.1',
      },
      redirect: 'manual',
    })
  })

  it('bounds responses without a declared content length', async () => {
    const cover = jpegCover()
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(new Uint8Array(MAX_EMBEDDED_MUSIC_COVER_BYTES + 1)))
      .mockResolvedValueOnce(new Response(new Uint8Array(cover)))

    const result = await fetchNeteaseMusicCover('https://p3.music.126.net/album.jpg')

    expect(result.bytes).toEqual(cover)
  })

  it('rejects untrusted cover hosts before fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(fetchNeteaseMusicCover('https://example.com/album.jpg')).rejects.toThrow(
      'Netease returned an untrusted cover URL.',
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

function jpegCover(): Uint8Array {
  return Uint8Array.from(
    atob(
      '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjI4LjEwMQD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAACAAIDASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAE1/f//Z',
    ),
    (character) => character.charCodeAt(0),
  )
}
