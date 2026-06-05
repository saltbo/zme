import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  discoverBooks,
  discoverMusicAlbums,
  getBookDetails,
  getMusicAlbumDetails,
  removeLibraryResource,
  saveLibraryResource,
  searchBooks,
  searchIndexers,
  searchMusicAlbums,
} from './api'

describe('resource api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds book provider request paths with encoded media keys', async () => {
    const fetch = stubJsonFetch({ results: [], item: null })

    await searchBooks({ query: 'matilda dahl', page: 2 })
    await getBookDetails('openlibrary:work:OL45883W')

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/books/search?q=matilda+dahl&page=2',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/books/openlibrary%3Awork%3AOL45883W',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('builds default resource discovery request paths', async () => {
    const fetch = stubJsonFetch({ results: [] })

    await discoverBooks({ mode: 'subject', period: 'daily', subject: 'fantasy', page: 3, pageSize: 30 })
    await discoverMusicAlbums({
      mode: 'genre',
      range: 'week',
      chartType: 'tracks',
      genre: 'jazz',
      releaseType: 'ep',
      year: '2024',
      page: 2,
      pageSize: 30,
    })

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/books/discover?mode=subject&period=daily&subject=fantasy&page=3&pageSize=30',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/music/discover?mode=genre&range=week&chartType=tracks&genre=jazz&releaseType=ep&year=2024&page=2&pageSize=30',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('omits incomplete music discovery years from API requests', async () => {
    const fetch = stubJsonFetch({ results: [] })

    await discoverMusicAlbums({
      mode: 'genre',
      range: 'week',
      chartType: 'albums',
      genre: 'jazz',
      releaseType: 'album',
      year: '202',
      page: 1,
      pageSize: 30,
    })

    expect(fetch).toHaveBeenCalledWith(
      '/api/music/discover?mode=genre&range=week&chartType=albums&genre=jazz&releaseType=album&page=1&pageSize=30',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('builds music provider request paths with encoded query parameters', async () => {
    const fetch = stubJsonFetch({ results: [], item: null })

    await searchMusicAlbums({ query: 'radiohead ok computer', page: 2 })
    await getMusicAlbumDetails('musicbrainz:release-group:b1392450-e666-3926-a536-22c65f834433')

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/music/search?q=radiohead+ok+computer&page=2',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/music/details?mediaKey=musicbrainz%3Arelease-group%3Ab1392450-e666-3926-a536-22c65f834433',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('saves and removes resource library items by encoded media key', async () => {
    const fetch = stubJsonFetch({ item: null })
    const input = {
      kind: 'book' as const,
      mediaKey: 'isbn:book:9780140328721',
    }

    await saveLibraryResource(input)
    await removeLibraryResource(input)

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/library/resources',
      expect.objectContaining({
        body: JSON.stringify(input),
        credentials: 'include',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
        method: 'PUT',
      }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/library/resources/isbn%3Abook%3A9780140328721',
      expect.objectContaining({
        body: JSON.stringify(input),
        credentials: 'include',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
        method: 'DELETE',
      }),
    )
  })

  it('uses the resource library endpoint for watched media keys', async () => {
    const fetch = stubJsonFetch({ item: null })
    const input = {
      kind: 'music' as const,
      mediaKey: 'musicbrainz:release-group:b1392450-e666-3926-a536-22c65f834433',
      status: 'watched' as const,
    }

    await saveLibraryResource(input)

    expect(fetch).toHaveBeenCalledWith(
      '/api/library/resources',
      expect.objectContaining({
        body: JSON.stringify(input),
        credentials: 'include',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
        method: 'PUT',
      }),
    )
  })

  it('sends target-aware resource indexer search parameters', async () => {
    const fetch = stubJsonFetch({ results: [] })

    await searchIndexers({
      query: 'Matilda Roald Dahl audiobook',
      target: 'audiobook',
      title: 'Matilda',
      aliases: ['Matilda, or, The Child Genius'],
      creators: ['Roald Dahl'],
      year: '1988',
      formats: ['audiobook', 'm4b', 'mp3'],
      narrator: 'Kate Winslet',
    })

    expect(fetch).toHaveBeenCalledWith(
      '/api/indexers/search?q=Matilda+Roald+Dahl+audiobook&target=audiobook&title=Matilda&aliases=Matilda%2C+or%2C+The+Child+Genius&creators=Roald+Dahl&year=1988&formats=audiobook%7Cm4b%7Cmp3&narrator=Kate+Winslet',
      expect.objectContaining({ credentials: 'include' }),
    )
  })
})

function stubJsonFetch(payload: unknown) {
  const fetch = vi
    .fn()
    .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(payload), { status: 200 })))
  vi.stubGlobal('fetch', fetch)
  return fetch
}
