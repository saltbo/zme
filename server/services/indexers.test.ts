import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchIndexers } from './indexers'

const indexer = {
  id: 'indexer-1',
  description: 'Prowlarr',
  kind: 'prowlarr',
  endpoint: 'http://prowlarr.local',
  credentialsJson: JSON.stringify({ apiKey: 'secret' }),
  optionsJson: '{}',
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

    const results = await searchIndexers(createDbWithIndexers([indexer]), {
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
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          { guid: 'matching-tvdb', title: 'Correct.Show.S01', tvdbId: 789 },
          { guid: 'wrong-tvdb', title: 'Wrong.Show.S01', tvdbId: 987 },
          { guid: 'matching-title', title: 'Correct Show (2026) S01 1080p' },
          { guid: 'wrong-title', title: 'Different Show (2026) S01 1080p' },
        ]),
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetch)

    const results = await searchIndexers(createDbWithIndexers([indexer]), {
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
})

function createDbWithIndexers(rows: unknown[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => rows,
      }),
    }),
  } as never
}
