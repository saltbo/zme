import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  discoverBooks,
  discoverMusicAlbums,
  getBookDetails,
  getMusicAlbumDetails,
  removeLibraryResource,
  saveLibraryResource,
  searchBooks,
  searchIndexerOnce,
  searchMusicAlbums,
} from '.'
import { continueConnectorLogin, syncConnector } from './connectors'
import { checkDownloaderHealth } from './downloaders'
import { checkIndexerHealth } from './indexers'
import { checkMediaSourceHealth } from './media-sources'

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
      '/api/books?q=matilda+dahl&page=2',
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
      '/api/book-recommendations?mode=subject&period=daily&subject=fantasy&page=3&pageSize=30',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/music-recommendations?mode=genre&range=week&chartType=tracks&genre=jazz&releaseType=ep&year=2024&page=2&pageSize=30',
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
      '/api/music-recommendations?mode=genre&range=week&chartType=albums&genre=jazz&releaseType=album&page=1&pageSize=30',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('builds music provider request paths with encoded query parameters', async () => {
    const fetch = stubJsonFetch({ results: [], item: null })

    await searchMusicAlbums({ query: 'radiohead ok computer', page: 2 })
    await getMusicAlbumDetails('musicbrainz:release-group:b1392450-e666-3926-a536-22c65f834433')

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/music?q=radiohead+ok+computer&page=2',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/music/musicbrainz%3Arelease-group%3Ab1392450-e666-3926-a536-22c65f834433',
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
      '/api/library/resources/isbn%3Abook%3A9780140328721',
      expect.objectContaining({
        body: JSON.stringify({}),
        credentials: 'include',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
        method: 'PUT',
      }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/library/resources/isbn%3Abook%3A9780140328721',
      expect.objectContaining({
        credentials: 'include',
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
      '/api/library/resources/musicbrainz%3Arelease-group%3Ab1392450-e666-3926-a536-22c65f834433',
      expect.objectContaining({
        body: JSON.stringify({ status: 'watched' }),
        credentials: 'include',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
        method: 'PUT',
      }),
    )
  })

  it('sends atomic indexer search parameters', async () => {
    const fetch = stubJsonFetch({ results: [] })

    await searchIndexerOnce({
      query: 'Dune 2021',
      searchType: 'search',
      categories: [2000, 2040],
    })

    expect(fetch).toHaveBeenCalledWith(
      '/api/release-candidates?q=Dune+2021&searchType=search&categories=2000%7C2040',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('uses resource-shaped connector continuation, sync-job, and health endpoints', async () => {
    const fetch = stubJsonFetch({})

    await continueConnectorLogin('attempt-1', 'confirm', { code: '123456' })
    await syncConnector('connector-1')
    await checkIndexerHealth('indexer-1')
    await checkMediaSourceHealth('source-1')
    await checkDownloaderHealth('downloader-1')

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/connector-login-attempts/attempt-1/response',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ challenge: 'confirm', input: { code: '123456' } }),
      }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/connector-sync-jobs',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ connectorId: 'connector-1' }),
        headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
      }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      '/api/indexers/indexer-1/health-observations',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      '/api/media-sources/source-1/health-observations',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      5,
      '/api/downloaders/downloader-1/health-observations',
      expect.objectContaining({ method: 'POST' }),
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
