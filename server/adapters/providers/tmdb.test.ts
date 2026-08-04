import { afterEach, describe, expect, it, vi } from 'vitest'
import { tmdbMediaProvider } from './tmdb'

afterEach(() => vi.unstubAllGlobals())

describe('TMDB request boundaries', () => {
  it('applies a timeout signal to metadata and genre requests', async () => {
    const fetch = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      const url = input.toString()
      return Response.json(url.includes('/genre/') ? { genres: [] } : { results: [] })
    })
    vi.stubGlobal('fetch', fetch)

    await expect(tmdbMediaProvider.search({ apiKey: 'tmdb-key', language: 'en-US' }, 'Dune')).resolves.toEqual([])
    expect(fetch).toHaveBeenCalledTimes(3)
    for (const [, init] of fetch.mock.calls) expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('applies a timeout signal to health probes', async () => {
    const fetch = vi.fn(async () => Response.json({}))
    vi.stubGlobal('fetch', fetch)

    await tmdbMediaProvider.probe({ apiKey: 'tmdb-key' })
    expect(fetch).toHaveBeenCalledWith(
      'https://api.themoviedb.org/3/configuration',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('rejects unsuccessful metadata responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 })),
    )
    await expect(tmdbMediaProvider.search({ apiKey: 'tmdb-key', language: 'en-US' }, 'Dune')).rejects.toThrow(
      'TMDB request failed: 503',
    )
  })

  it('projects a distinct English translation from movie details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        if (input.toString().includes('/genre/')) return Response.json({ genres: [] })
        return Response.json({
          id: 1,
          title: '本地标题',
          original_title: '原始标题',
          original_language: 'zh',
          overview: '',
          release_date: '2024-01-01',
          translations: { translations: [{ iso_639_1: 'en', data: { title: 'English Title' } }] },
        })
      }),
    )

    await expect(
      tmdbMediaProvider.details({ apiKey: 'tmdb-key', language: 'zh-CN' }, 'movie', 1, 'US'),
    ).resolves.toMatchObject({
      originalTitle: '原始标题',
      englishTitle: 'English Title',
    })
  })
})
