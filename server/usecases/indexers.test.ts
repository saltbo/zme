import { indexerGateways } from '@server/adapters/gateways/indexers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import { searchDownloadIndexers, searchIndexers } from './indexers'
import type { IndexerRecord } from './ports'

const indexer: IndexerRecord = {
  id: 'indexer-1',
  description: 'Prowlarr',
  kind: 'prowlarr',
  config: {
    endpoint: 'http://prowlarr.local',
    credentials: { apiKey: 'secret' },
    options: {},
  },
  enabled: true,
  healthStatus: 'online',
  healthMessage: null,
  healthCheckedAt: null,
  createdAt: '2026-06-04T00:00:00.000Z',
  updatedAt: '2026-06-04T00:00:00.000Z',
}

describe('searchIndexers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses title search and filters explicit id conflicts or title mismatches', async () => {
    const fetch = vi.fn().mockImplementation((url: URL) => {
      const search = new URL(url).searchParams.get('query')
      const payload =
        search === 'Correct Movie 2026'
          ? [
              { guid: 'matching-tmdb', title: 'Correct.Movie.2026', tmdbId: 111 },
              { guid: 'wrong-id', title: 'Wrong.Movie.2026', tmdbId: 222, imdbId: 7654321 },
            ]
          : [
              { guid: 'matching-imdb', title: 'Correct Movie English 2026', imdbId: 1234567 },
              { guid: 'matching-title', title: 'Correct Movie English (2026) 1080p' },
              { guid: 'collection', title: 'Correct Movie English 2026 Collection' },
              { guid: 'missing-id', title: 'Unverifiable.Movie.2026' },
            ]

      return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetch)

    const results = await searchIndexers(createDepsWithIndexers([indexer]), {
      query: 'Correct Movie 2026',
      title: 'Correct Movie',
      aliases: ['Correct Movie English'],
      year: '2026',
      kind: 'movie',
      imdbId: 'tt1234567',
      tmdbId: 111,
    })

    expect(results.map((item) => item.id)).toEqual(['matching-tmdb', 'matching-imdb', 'matching-title'])
    expect(fetch).toHaveBeenCalledTimes(2)

    const urls = fetch.mock.calls.map((call) => new URL(call[0].toString()))
    expect(urls.map((url) => url.searchParams.get('type'))).toEqual(['search', 'search'])
    expect(urls.map((url) => url.searchParams.get('query'))).toEqual([
      'Correct Movie 2026',
      'Correct Movie English 2026',
    ])
  })

  it('keeps tv results by tvdb id or title year match', async () => {
    const fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            { guid: 'matching-tvdb', title: 'Correct.Show.S01', tvdbId: 789 },
            { guid: 'wrong-tvdb', title: 'Wrong.Show.S01', tvdbId: 987 },
            { guid: 'matching-title', title: 'Correct Show (2026) S01 1080p' },
            { guid: 'wrong-title', title: 'Different Show (2026) S01 1080p' },
          ]),
          { status: 200 },
        ),
      ),
    )
    vi.stubGlobal('fetch', fetch)

    const results = await searchIndexers(createDepsWithIndexers([indexer]), {
      query: 'Correct Show 2026',
      title: 'Correct Show',
      aliases: [],
      year: '2026',
      kind: 'tv',
      imdbId: 'tt1234567',
      tmdbId: 111,
      tvdbId: 789,
    })

    expect(results.map((item) => item.id)).toEqual(['matching-tvdb', 'matching-title'])

    const url = new URL(fetch.mock.calls[0][0].toString())
    expect(url.searchParams.get('type')).toBe('search')
    expect(url.searchParams.get('query')).toBe('Correct Show 2026')
  })

  it('searches and filters music album results with audio categories', async () => {
    const fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            {
              guid: 'album-flac',
              title: 'Radiohead OK Computer 1997 FLAC',
              categories: [{ id: 3040, name: 'Audio/Lossless' }],
              seeders: 20,
            },
            {
              guid: 'wrong-album',
              title: 'Radiohead In Rainbows 2007 FLAC',
              categories: [{ id: 3040, name: 'Audio/Lossless' }],
              seeders: 100,
            },
            {
              guid: 'movie-noise',
              title: 'OK Computer 1997 1080p',
              categories: [{ id: 2040, name: 'Movies/HD' }],
            },
          ]),
          { status: 200 },
        ),
      ),
    )
    vi.stubGlobal('fetch', fetch)

    const results = await searchDownloadIndexers(createDepsWithIndexers([indexer]), {
      target: 'music',
      query: 'OK Computer Radiohead',
      title: 'OK Computer',
      creators: ['Radiohead'],
      year: '1997',
      formats: ['FLAC'],
    })

    expect(results.map((item) => item.id)).toEqual(['album-flac'])
    expect(results[0].downloadTarget).toBe('music')

    const urls = fetch.mock.calls.map((call) => new URL(call[0].toString()))
    expect(urls.every((url) => url.searchParams.get('type') === 'audiosearch')).toBe(true)
    expect(urls[0].searchParams.getAll('categories')).toEqual(['3000', '3040'])
  })

  it('searches and filters ebook results separately from audiobook noise', async () => {
    const fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            {
              guid: 'dune-epub',
              title: 'Frank Herbert - Dune 1965 EPUB',
              categories: [{ id: 7020, name: 'Books/EBook' }],
              seeders: 30,
            },
            {
              guid: 'dune-audio',
              title: 'Frank Herbert - Dune Audiobook',
              categories: [{ id: 3030, name: 'Audio/Audiobook' }],
              seeders: 60,
            },
          ]),
          { status: 200 },
        ),
      ),
    )
    vi.stubGlobal('fetch', fetch)

    const results = await searchDownloadIndexers(createDepsWithIndexers([indexer]), {
      target: 'ebook',
      query: 'Dune Frank Herbert ebook',
      title: 'Dune',
      creators: ['Frank Herbert'],
      year: '1965',
      formats: ['EPUB'],
    })

    expect(results.map((item) => item.id)).toEqual(['dune-epub'])
    expect(results[0].downloadTarget).toBe('ebook')

    const urls = fetch.mock.calls.map((call) => new URL(call[0].toString()))
    expect(urls.every((url) => url.searchParams.get('type') === 'booksearch')).toBe(true)
    expect(urls[0].searchParams.getAll('categories')).toEqual(['7000', '7020'])
  })

  it('searches and filters audiobook results with narrator hints', async () => {
    const fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            {
              guid: 'hail-mary-audio',
              title: 'Andy Weir - Project Hail Mary - Ray Porter - M4B',
              categories: [{ id: 3030, name: 'Audio/Audiobook' }],
              seeders: 40,
            },
            {
              guid: 'hail-mary-ebook',
              title: 'Andy Weir - Project Hail Mary EPUB',
              categories: [{ id: 7020, name: 'Books/EBook' }],
              seeders: 80,
            },
          ]),
          { status: 200 },
        ),
      ),
    )
    vi.stubGlobal('fetch', fetch)

    const results = await searchDownloadIndexers(createDepsWithIndexers([indexer]), {
      target: 'audiobook',
      query: 'Project Hail Mary Andy Weir audiobook',
      title: 'Project Hail Mary',
      creators: ['Andy Weir'],
      narrator: 'Ray Porter',
      formats: ['M4B'],
    })

    expect(results.map((item) => item.id)).toEqual(['hail-mary-audio'])
    expect(results[0].downloadTarget).toBe('audiobook')

    const urls = fetch.mock.calls.map((call) => new URL(call[0].toString()))
    expect(urls.every((url) => url.searchParams.get('type') === 'audiosearch')).toBe(true)
    expect(urls[0].searchParams.getAll('categories')).toEqual(['3030'])
    expect(urls.some((url) => url.searchParams.get('query')?.includes('Ray Porter'))).toBe(true)
  })

  it('filters noisy unrelated Prowlarr results for resource targets', async () => {
    const fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            {
              guid: 'wrong-title',
              title: 'Frank Herbert - Children of Dune EPUB',
              categories: [{ id: 7020, name: 'Books/EBook' }],
              seeders: 100,
            },
            {
              guid: 'wrong-creator',
              title: 'Dune 1965 EPUB',
              categories: [{ id: 7020, name: 'Books/EBook' }],
              seeders: 90,
            },
            {
              guid: 'wrong-category',
              title: 'Frank Herbert - Dune 1965 1080p',
              categories: [{ id: 2040, name: 'Movies/HD' }],
              seeders: 80,
            },
          ]),
          { status: 200 },
        ),
      ),
    )
    vi.stubGlobal('fetch', fetch)

    const results = await searchDownloadIndexers(createDepsWithIndexers([indexer]), {
      target: 'ebook',
      query: 'Dune Frank Herbert ebook',
      title: 'Dune',
      creators: ['Frank Herbert'],
      year: '1965',
      formats: ['EPUB'],
    })

    expect(results).toEqual([])
  })

  it('retries resource searches without categories when scoped results are only noise', async () => {
    const fetch = vi.fn().mockImplementation((url: URL) => {
      const searchUrl = new URL(url)
      const hasCategories = searchUrl.searchParams.has('categories')
      const payload = hasCategories
        ? [
            {
              guid: 'category-noise',
              title: 'Different Book EPUB',
              categories: [{ id: 7020, name: 'Books/EBook' }],
              seeders: 50,
            },
          ]
        : [
            {
              guid: 'fallback-ebook',
              title: 'Frank Herbert - Dune 1965 EPUB',
              seeders: 10,
            },
          ]

      return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetch)

    const results = await searchDownloadIndexers(createDepsWithIndexers([indexer]), {
      target: 'ebook',
      query: 'Dune Frank Herbert ebook',
      title: 'Dune',
      creators: ['Frank Herbert'],
      year: '1965',
      formats: ['EPUB'],
    })

    expect(results.map((item) => item.id)).toEqual(['fallback-ebook'])

    const urls = fetch.mock.calls.map((call) => new URL(call[0].toString()))
    expect(urls.some((url) => url.searchParams.has('categories'))).toBe(true)
    expect(urls.some((url) => !url.searchParams.has('categories'))).toBe(true)
  })
})

function createDepsWithIndexers(records: IndexerRecord[]): Deps {
  return {
    indexersRepo: {
      listEnabled: async () => records,
    },
    indexerGateways,
  } as never as Deps
}
