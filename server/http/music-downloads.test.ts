import type { MusicFileTags } from '@server/music-tags'
import { parseBuffer } from 'music-metadata'
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

  it('returns resolved metadata without a body for HEAD', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const response = await deliverMusicResource('HEAD', resource(), 'Artist - Track.mp3', tags, true)

    expect(response.status).toBe(200)
    expect(response.body).toBeNull()
    expect(response.headers.get('location')).toBe('https://m701.music.126.net/audio.mp3')
    expect(response.headers.get('content-type')).toBe('audio/mpeg')
    expect(response.headers.get('content-length')).toBe('4096')
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
    const cover = jpegCover()
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(audio, { headers: { 'Content-Type': 'audio/mpeg' } }))
      .mockResolvedValueOnce(new Response(cover.buffer as ArrayBuffer, { headers: { 'Content-Type': 'image/jpeg' } }))

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
    expect(fetchSpy).toHaveBeenNthCalledWith(2, new URL('https://p3.music.126.net/album.jpg?param=600y600'), {
      headers: {
        Referer: 'https://music.163.com/',
        'User-Agent': 'Mozilla/5.0 ZME/0.0.1',
      },
      redirect: 'manual',
    })
    expect(new TextDecoder().decode(bytes.subarray(0, 512))).toContain('APIC')
  })

  it('streams a standards-compliant FLAC with Vorbis tags and artwork', async () => {
    const audio = new Uint8Array([0xff, 0xf8, 0x69, 0x00, 1, 2, 3, 4])
    const source = concat([
      new TextEncoder().encode('fLaC'),
      new Uint8Array([0x80, 0, 0, 34]),
      new Uint8Array(34),
      audio,
    ])
    const cover = jpegCover()
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(source.buffer as ArrayBuffer, { headers: { 'Content-Type': 'audio/flac' } }))
      .mockResolvedValueOnce(new Response(cover.buffer as ArrayBuffer, { headers: { 'Content-Type': 'image/jpeg' } }))

    const response = await deliverMusicResource(
      'GET',
      {
        ...resource(),
        url: 'https://m701.music.126.net/audio.flac',
        extension: 'flac',
        contentType: 'audio/flac',
        contentLength: null,
      },
      'Artist - Track.flac',
      { ...tags, coverUrl: 'https://p3.music.126.net/album.jpg' },
      true,
    )
    const bytes = new Uint8Array(await response.arrayBuffer())
    const metadata = await parseBuffer(bytes, { mimeType: 'audio/flac', size: bytes.byteLength })

    expect(response.status).toBe(200)
    expect(metadata.common.title).toBe(tags.title)
    expect(metadata.common.album).toBe(tags.album)
    expect(metadata.common.picture?.[0]?.data).toEqual(cover)
    expect(bytes.slice(-audio.byteLength)).toEqual(audio)
  })

  it('follows a cover redirect only when every location remains on a trusted Netease host', async () => {
    const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4, 5, 6, 7, 8])
    const cover = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 0xff, 0xd9])
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(audio))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: 'https://p4.music.126.net/redirected-album.jpg' },
        }),
      )
      .mockResolvedValueOnce(new Response(cover))

    const response = await deliverMusicResource(
      'GET',
      { ...resource(), contentLength: null },
      'Artist - Track.mp3',
      { ...tags, coverUrl: 'https://p3.music.126.net/album.jpg' },
      true,
    )

    expect(response.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(3)
    expect(fetchSpy).toHaveBeenNthCalledWith(3, new URL('https://p4.music.126.net/redirected-album.jpg'), {
      headers: {
        Referer: 'https://music.163.com/',
        'User-Agent': 'Mozilla/5.0 ZME/0.0.1',
      },
      redirect: 'manual',
    })
  })

  it('rejects a cover redirect to an untrusted host', async () => {
    const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4, 5, 6, 7, 8])
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(audio))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: 'https://example.com/album.jpg' },
        }),
      )

    await expect(
      deliverMusicResource(
        'GET',
        { ...resource(), contentLength: null },
        'Artist - Track.mp3',
        { ...tags, coverUrl: 'https://p3.music.126.net/album.jpg' },
        true,
      ),
    ).rejects.toThrow('Netease returned an untrusted cover URL.')
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

function concat(chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function jpegCover(): Uint8Array {
  return Uint8Array.from(
    atob(
      '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjI4LjEwMQD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAACAAIDASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAE1/f//Z',
    ),
    (character) => character.charCodeAt(0),
  )
}
