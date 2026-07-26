import type { MusicFileTags } from '@server/domain/music-file-tags'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deliverMusicResource, redirectMusicResource } from './music-downloads'

const tags: MusicFileTags = {
  title: 'Track',
  artists: ['Artist'],
  album: 'Album',
  albumArtists: ['Artist'],
  trackNumber: 2,
  discNumber: 1,
  releaseDate: '2024-01-02',
  compilation: false,
  coverUrl: null,
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('music download redirect', () => {
  it('redirects the downloader to the resolved provider URL without proxying bytes', () => {
    const response = redirectMusicResource(
      {
        url: 'https://m701.music.126.net/audio.mp3',
        headers: { Referer: 'https://music.163.com/' },
        quality: 'exhigh',
        extension: 'mp3',
        contentType: 'audio/mpeg',
        contentLength: 4096,
      },
      'Artist - Track.mp3',
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://m701.music.126.net/audio.mp3')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('referer')).toBeNull()
    expect(response.body).toBeNull()
  })

  it('keeps redirecting when automatic tagging is disabled', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const response = await deliverMusicResource('GET', resource(), 'Artist - Track.mp3', tags, false)

    expect(response.status).toBe(307)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('streams a tagged file when the provider MP3 has no tags', async () => {
    const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4, 5, 6, 7, 8])
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(audio)
            controller.close()
          },
        }),
        { headers: { 'Content-Type': 'audio/mpeg' } },
      ),
    )

    const response = await deliverMusicResource(
      'GET',
      { ...resource(), contentLength: null },
      'Artist - Track.mp3',
      tags,
      true,
    )
    const bytes = new Uint8Array(await response.arrayBuffer())

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('accept-ranges')).toBe('none')
    expect(bytes.slice(-audio.byteLength)).toEqual(audio)
  })

  it('downloads a trusted Netease cover when the file has no embedded artwork', async () => {
    const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4, 5, 6, 7, 8])
    const cover = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 0xff, 0xd9])
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(audio, { headers: { 'Content-Type': 'audio/mpeg' } }))
      .mockResolvedValueOnce(new Response(cover, { headers: { 'Content-Type': 'image/jpeg' } }))

    const response = await deliverMusicResource(
      'GET',
      { ...resource(), contentLength: null },
      'Artist - Track.mp3',
      { ...tags, coverUrl: 'https://p3.music.126.net/album.jpg' },
      true,
    )
    const bytes = new Uint8Array(await response.arrayBuffer())

    expect(response.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy).toHaveBeenNthCalledWith(2, new URL('https://p3.music.126.net/album.jpg'), {
      headers: {
        Referer: 'https://music.163.com/',
        'User-Agent': 'Mozilla/5.0 ZME/0.0.1',
      },
      redirect: 'error',
    })
    expect(new TextDecoder().decode(bytes.subarray(0, 512))).toContain('APIC')
  })
})

function resource() {
  return {
    url: 'https://m701.music.126.net/audio.mp3',
    headers: { Referer: 'https://music.163.com/' },
    quality: 'exhigh' as const,
    extension: 'mp3',
    contentType: 'audio/mpeg',
    contentLength: 4096,
  }
}
