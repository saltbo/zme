import { musicBrainzMusicProvider } from '@server/adapters/music-catalogs/musicbrainz'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openLibraryBookProvider } from './books'
import { tmdbMediaProvider } from './tmdb'

const albumId = '12345678-1234-4234-8234-123456789abc'
const editionId = '22345678-1234-4234-8234-123456789abc'
const recordingId = '32345678-1234-4234-8234-123456789abc'
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })

describe('catalog provider boundaries', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads an album that exists independently of any release edition', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL) => {
        if (input.hostname === 'coverartarchive.org') return new Response(null, { status: 404 })
        return json({ id: albumId, title: 'Unreleased album', 'artist-credit': [], releases: [] })
      }),
    )
    await expect(musicBrainzMusicProvider.details(`musicbrainz:release-group:${albumId}`)).resolves.toMatchObject({
      mediaKey: `musicbrainz:release-group:${albumId}`,
      title: 'Unreleased album',
      preferredRelease: null,
      releases: [],
      media: [],
    })
  })

  it('uses typed TMDB searches with real pagination and retains upstream ranks after filtering people', async () => {
    const requests: URL[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL) => {
        requests.push(input)
        if (input.pathname.includes('/genre/')) return json({ genres: [] })
        return json({
          page: 2,
          total_pages: 5,
          total_results: 81,
          results: [
            { id: 1, media_type: 'person', name: 'Person' },
            { id: 2, media_type: 'movie', title: 'Movie' },
          ],
        })
      }),
    )
    const page = await tmdbMediaProvider.chartPage(
      { apiKey: 'fixture', language: 'en-US' },
      { chart: 'trending', period: 'week', page: 2 },
    )
    expect(page.results).toHaveLength(1)
    expect(page.ranks).toEqual([22])
    expect(page.totalPages).toBe(5)
    expect(
      requests.some((url) => url.pathname === '/3/trending/all/week' && url.searchParams.get('page') === '2'),
    ).toBe(true)
    await tmdbMediaProvider.searchPage(
      { apiKey: 'fixture', language: 'en-US' },
      { query: 'A movie', page: 2, kind: 'movie' },
    )
    expect(
      requests.some(
        (url) =>
          url.pathname === '/3/search/movie' &&
          url.searchParams.get('query') === 'A movie' &&
          url.searchParams.get('page') === '2',
      ),
    ).toBe(true)
  })

  it('reads book edition pages without treating the first detail preview as the entire collection', async () => {
    const fetch = vi.fn(async (_input: URL) =>
      json({ size: 23, entries: [{ key: '/books/OL2M', title: 'Edition', isbn_13: ['9780140328721'] }] }),
    )
    vi.stubGlobal('fetch', fetch)
    const result = await openLibraryBookProvider.editions('openlibrary:work:OL1W', 2, 20)
    expect(result).toMatchObject({
      page: 2,
      totalResults: 23,
      totalPages: 2,
      results: [{ mediaKey: 'openlibrary:edition:OL2M' }],
    })
    const url = fetch.mock.calls[0]?.[0] as unknown as URL
    expect(url.pathname).toBe('/works/OL1W/editions.json')
    expect(url.searchParams.get('offset')).toBe('20')
    expect(url.searchParams.get('limit')).toBe('20')
  })

  it('browses album editions and reads recordings using their independent identifiers', async () => {
    const requests: URL[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL) => {
        requests.push(input)
        if (input.pathname === '/ws/2/release')
          return json({
            'release-count': 21,
            releases: [{ id: editionId, title: 'Edition', media: [{ format: 'CD' }] }],
          })
        if (input.pathname === `/ws/2/recording/${recordingId}`)
          return json({
            id: recordingId,
            title: 'Recording',
            length: 123,
            'artist-credit': [],
            isrcs: ['TEST'],
            releases: [{ id: editionId, title: 'Edition' }],
          })
        throw new Error(`Unexpected catalog URL: ${input}`)
      }),
    )
    const editions = await musicBrainzMusicProvider.editions(`musicbrainz:release-group:${albumId}`, 2, 20)
    expect(editions).toMatchObject({
      page: 2,
      totalResults: 21,
      totalPages: 2,
      results: [{ mediaKey: `musicbrainz:release:${editionId}`, formats: ['CD'] }],
    })
    expect(requests[0].searchParams.get('release-group')).toBe(albumId)
    expect(requests[0].searchParams.get('offset')).toBe('20')
    const recording = await musicBrainzMusicProvider.recording(`musicbrainz:recording:${recordingId}`)
    expect(recording).toMatchObject({
      mediaKey: `musicbrainz:recording:${recordingId}`,
      durationMs: 123,
      albumEditions: [{ mediaKey: `musicbrainz:release:${editionId}` }],
    })
  })
})
