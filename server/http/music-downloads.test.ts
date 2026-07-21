import { describe, expect, it } from 'vitest'
import { redirectMusicResource } from './music-downloads'

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
})
