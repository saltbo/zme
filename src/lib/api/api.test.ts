import type { CatalogAlbum, CatalogAlbumEdition } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDownload,
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
import { submitConnectorChallengeResponse, syncConnector } from './connectors'
import { checkDownloaderHealth } from './downloaders'
import { checkIndexerHealth } from './indexers'
import { checkMediaSourceHealth } from './media-sources'

describe('resource api client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds book provider request paths with encoded media keys', async () => {
    const fetch = stubJsonFetch({ items: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } })

    await searchBooks({ query: 'matilda dahl', page: 2 })
    await getBookDetails('openlibrary:work:OL45883W')

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/catalog/books?q=matilda+dahl&page=2',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/catalog/books/openlibrary%3Awork%3AOL45883W',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('builds default resource discovery request paths', async () => {
    const fetch = stubJsonFetch({ items: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } })

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
      '/api/catalog/books?subject=fantasy&page=3&pageSize=30',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/catalog/albums?genre=jazz&releaseType=ep&year=2024&page=2&pageSize=30',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('omits incomplete music discovery years from API requests', async () => {
    const fetch = stubJsonFetch({ items: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } })

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
      '/api/catalog/albums?genre=jazz&releaseType=album&page=1&pageSize=30',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('builds music provider request paths with encoded query parameters', async () => {
    const fetch = stubJsonFetch({ items: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } })

    await searchMusicAlbums({ query: 'radiohead ok computer', page: 2 })
    await getMusicAlbumDetails('musicbrainz:release-group:b1392450-e666-3926-a536-22c65f834433')

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/catalog/albums?q=radiohead+ok+computer&page=2',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/catalog/albums/musicbrainz%3Arelease-group%3Ab1392450-e666-3926-a536-22c65f834433',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('reconciles separate album and edition resources with the existing album view', async () => {
    const albumKey = 'musicbrainz:release-group:12345678-1234-4234-8234-123456789abc'
    const editionKey = 'musicbrainz:release:22345678-1234-4234-8234-123456789abc'
    const common = {
      provider: 'musicbrainz' as const,
      releaseGroupMbid: albumKey.split(':')[2],
      artist: null,
      artists: [],
      firstReleaseDate: '2020',
      releaseYear: '2020',
      releaseDate: '2021',
      country: 'JP',
      primaryType: 'Album',
      secondaryTypes: [],
      disambiguation: null,
      coverArt: { frontUrl: null, frontThumbnailUrl: null, backUrl: null, backThumbnailUrl: null },
      aliases: [],
    }
    const edition: CatalogAlbumEdition = {
      ...common,
      mediaKey: editionKey,
      mbid: editionKey.split(':')[2],
      title: 'Edition',
      resourceType: 'release',
      albumMediaKey: albumKey,
      barcode: null,
      status: 'Official',
      formats: ['CD'],
      links: {},
      discs: [
        {
          position: 2,
          title: null,
          format: 'CD',
          trackCount: 1,
          tracks: [
            {
              position: 1,
              number: '1',
              title: 'Track',
              lengthMs: 123,
              recordingMbid: null,
              recordingMediaKey: null,
              isrcs: [],
            },
          ],
        },
      ],
    }
    const album: CatalogAlbum = {
      ...common,
      mediaKey: albumKey,
      mbid: albumKey.split(':')[2],
      title: 'Album',
      resourceType: 'release-group',
      preferredEdition: edition,
      links: {},
    }
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(album), { headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(edition), { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetch)
    const albumView = await getMusicAlbumDetails(albumKey)
    const editionView = await getMusicAlbumDetails(editionKey)
    expect(albumView).toMatchObject({
      detailMediaKey: albumKey,
      releaseMbid: edition.mbid,
      media: [{ position: 2, tracks: [{ position: 1, title: 'Track' }] }],
    })
    expect(editionView).toMatchObject({ detailMediaKey: editionKey, resourceType: 'release', media: albumView.media })
    expect(fetch.mock.calls[1][0]).toBe(`/api/catalog/album-editions/${encodeURIComponent(editionKey)}`)
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
      '/api/library/items/isbn%3Abook%3A9780140328721',
      expect.objectContaining({
        body: JSON.stringify({}),
        credentials: 'include',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
        method: 'PUT',
      }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/library/items/isbn%3Abook%3A9780140328721',
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
      '/api/library/items/musicbrainz%3Arelease-group%3Ab1392450-e666-3926-a536-22c65f834433',
      expect.objectContaining({
        body: JSON.stringify({ status: 'watched' }),
        credentials: 'include',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
        method: 'PUT',
      }),
    )
  })

  it('sends atomic indexer search parameters', async () => {
    const fetch = stubJsonFetch({ items: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } })

    await searchIndexerOnce({
      mediaKey: 'openlibrary:work:OL45804W',
      query: 'Dune 2021',
      searchType: 'search',
      categories: [2000, 2040],
      target: 'ebook',
    })

    expect(fetch).toHaveBeenCalledWith(
      '/api/torrents?mediaKey=openlibrary%3Awork%3AOL45804W&q=Dune+2021&target=ebook&view=full&page=1&pageSize=50',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('identifies browser download creation requests', async () => {
    const fetch = stubJsonFetch({ item: { status: 'submitted' } })

    await createDownload({
      downloaderId: 'downloader-1',
      resourceRef: 'torrent-ref:v1:opaque',
    })

    expect(fetch).toHaveBeenCalledWith(
      '/api/downloads',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Idempotency-Key': expect.stringMatching(/^[0-9a-f-]{36}$/) }),
        method: 'POST',
      }),
    )
  })

  it('uses the same download creation endpoint without a downloader for local handoff', async () => {
    const source = { id: 'local:source', kind: 'magnet', href: 'magnet:?xt=urn:btih:test' }
    const fetch = stubJsonFetch(source)
    expect(await createDownload({ resourceRef: 'torrent-ref:v1:opaque' })).toEqual(source)
    expect(fetch).toHaveBeenCalledWith(
      '/api/downloads',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ resourceRef: 'torrent-ref:v1:opaque' }),
        headers: expect.not.objectContaining({ 'Idempotency-Key': expect.anything() }),
      }),
    )
  })

  it('uses resource-shaped connector continuation, sync-job, and health endpoints', async () => {
    const fetch = stubJsonFetch({})

    await submitConnectorChallengeResponse('attempt-1', { code: '123456' })
    await syncConnector('connector-1')
    await checkIndexerHealth('indexer-1')
    await checkMediaSourceHealth('source-1')
    await checkDownloaderHealth('downloader-1')

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/connector-login-attempts/attempt-1/challenge-response',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ input: { code: '123456' } }),
      }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      '/api/connector-sync-jobs',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ connectorId: 'connector-1' }),
        headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
      }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      '/api/indexers/indexer-1/health',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      5,
      '/api/media-sources/source-1/health',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      6,
      '/api/downloaders/downloader-1/health',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
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
