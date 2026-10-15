import type { Env } from '@server/env'
import type { Deps } from '@server/usecases/deps'
import type { BookDetails, MediaDetails, MusicAlbumDetails, MusicAlbumSearchItem } from '@shared/types'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerBookRoutes } from './books'
import { registerChartRoutes } from './charts'
import type { AppEnv } from './context'
import { registerMediaRoutes } from './media'
import { registerMusicRoutes } from './music'
import { normalizeProblemMiddleware, requestBoundaryMiddleware } from './protocol'
import { registerResourceApiRoutes } from './resource-api'

const albumKey = 'musicbrainz:release-group:12345678-1234-4234-8234-123456789abc'
const editionKey = 'musicbrainz:release:22345678-1234-4234-8234-123456789abc'
const recordingKey = 'musicbrainz:recording:32345678-1234-4234-8234-123456789abc'
const bookKey = 'openlibrary:work:OL1W'
const bookEditionKey = 'openlibrary:edition:OL2M'
const movie = {
  id: 550,
  kind: 'movie' as const,
  title: 'Fixture',
  originalTitle: 'Fixture',
  overview: '',
  posterUrl: null,
  backdropUrl: null,
  releaseYear: '1999',
  rating: 8,
  genres: ['Drama'],
}
const season = {
  id: 101,
  seasonNumber: 0,
  title: 'Specials',
  overview: '',
  posterUrl: null,
  airDate: null,
  episodeCount: 1,
  rating: null,
  seriesId: 55,
  episodes: [
    {
      id: 1001,
      episodeNumber: 1,
      title: 'Special episode',
      overview: '',
      stillUrl: null,
      airDate: null,
      runtime: null,
      rating: null,
    },
  ],
}
const book: BookDetails = {
  mediaKey: bookKey,
  title: 'Book',
  authors: [],
  languages: [],
  firstPublishYear: null,
  coverUrl: null,
  isbnCandidates: [],
  editionKeys: [bookEditionKey],
  aliases: [],
  description: null,
  covers: [],
  workKey: bookKey,
  editionKey: bookEditionKey,
  editions: [],
}
const album: MusicAlbumSearchItem = {
  mediaKey: albumKey,
  provider: 'musicbrainz',
  resourceType: 'release-group',
  mbid: albumKey.split(':')[2],
  releaseGroupMbid: albumKey.split(':')[2],
  title: 'Album',
  artist: null,
  artists: [],
  firstReleaseDate: '2020',
  releaseYear: '2020',
  releaseDate: '2020',
  country: null,
  primaryType: 'Album',
  secondaryTypes: [],
  disambiguation: null,
  coverArt: { frontUrl: null, frontThumbnailUrl: null, backUrl: null, backThumbnailUrl: null },
}
const edition = {
  mediaKey: editionKey,
  mbid: editionKey.split(':')[2],
  title: 'Album, edition two',
  date: '2021',
  country: 'JP',
  status: 'Official',
  barcode: null,
  formats: ['CD'],
}
const track = {
  position: 1,
  number: '1',
  title: 'Recording',
  lengthMs: 123,
  recordingMbid: recordingKey.split(':')[2],
  recordingMediaKey: recordingKey,
  isrcs: [],
}
const albumDetails: MusicAlbumDetails = {
  ...album,
  detailMediaKey: albumKey,
  releaseMbid: edition.mbid,
  preferredRelease: edition,
  releases: [edition],
  country: 'JP',
  releaseDate: '2021',
  barcode: null,
  aliases: [],
  formats: ['CD'],
  media: [
    { position: 1, format: 'CD', title: null, trackCount: 1, tracks: [track] },
    { position: 2, format: 'CD', title: null, trackCount: 1, tracks: [{ ...track, title: 'Another track position' }] },
  ],
}

function fixture() {
  const deps = {
    mediaSourcesRepo: {
      findEnabled: vi.fn(async () => ({ credentials: { apiKey: 'fixture' }, options: { language: 'en-US' } })),
    },
    mediaProvider: {
      searchPage: vi.fn(async () => ({ results: [movie], page: 1, totalResults: 1, totalPages: 1 })),
      discover: vi.fn(async () => ({ results: [movie], page: 1, totalResults: 1, totalPages: 1 })),
      details: vi.fn(async () => ({ ...movie, seasons: [season] }) as unknown as MediaDetails),
      season: vi.fn(async () => season),
      chartPage: vi.fn(async () => ({ results: [movie], ranks: [22], page: 2, totalResults: 50, totalPages: 3 })),
      personCredits: vi.fn(async () => ({ person: { id: 7, name: 'Person' }, results: [movie] })),
    },
    bookProvider: {
      search: vi.fn(async () => ({ results: [book], page: 1, totalResults: 1, totalPages: 1 })),
      discover: vi.fn(async () => ({ results: [book], page: 1, totalResults: 1, totalPages: 1 })),
      details: vi.fn(async (key: string) => ({ ...book, mediaKey: key })),
      editions: vi.fn(async () => ({
        results: [{ mediaKey: bookEditionKey }],
        page: 2,
        totalResults: 21,
        totalPages: 2,
      })),
    },
    musicProvider: {
      search: vi.fn(async () => ({ results: [album], page: 1, totalResults: 99, totalPages: 5 })),
      details: vi.fn(async () => albumDetails),
      editions: vi.fn(async () => ({ results: [edition], page: 1, totalResults: 1, totalPages: 1 })),
      recording: vi.fn(async () => ({
        mediaKey: recordingKey,
        title: 'Recording',
        artists: [],
        durationMs: 123,
        isrcs: [],
        albumEditions: [{ mediaKey: editionKey, title: edition.title }],
      })),
      discover: vi.fn(async () => ({
        results: [{ ...album, mediaKey: editionKey, resourceType: 'release' }],
        page: 1,
        totalResults: 999,
        totalPages: 50,
      })),
    },
  }
  const app = new Hono<AppEnv>()
  app.use('*', requestBoundaryMiddleware)
  app.use('*', normalizeProblemMiddleware)
  app.use('*', async (c, next) => {
    c.set('deps', deps as unknown as Deps)
    await next()
  })
  const catalog = new Hono<AppEnv>()
  registerResourceApiRoutes(catalog)
  registerMediaRoutes(catalog)
  registerBookRoutes(catalog)
  registerMusicRoutes(catalog)
  app.route('/api/catalog', catalog)
  registerChartRoutes(app)
  const request = (path: string) =>
    app.fetch(new Request(`https://zme.test${path}`), { PUBLIC_APP_ORIGIN: 'https://zme.test' } as Env)
  return { deps, request }
}

describe('catalog resources and parent relationships', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('queries movie collections without exposing upstream sort names or ignoring filters', async () => {
    const { request, deps } = fixture()
    const response = await request('/api/catalog/movies?year=2020&orderBy=rating%20desc')
    expect(response.status).toBe(200)
    expect(deps.mediaProvider.discover.mock.calls[0]).toEqual([
      expect.any(Object),
      expect.objectContaining({ kind: 'movie', year: 2020, sortBy: 'vote_average.desc' }),
    ])
    expect(await response.json()).toMatchObject({
      items: [{ mediaKey: 'tmdb:movie:550', links: { self: 'https://zme.test/api/catalog/movies/550' } }],
      pagination: { totalItems: 1 },
    })
    expect((await request('/api/catalog/movies?q=Film&year=2020')).status).toBe(422)
    expect((await request('/api/catalog/movies?sortBy=vote_average.desc')).status).toBe(422)
    expect((await request('/api/catalog/movies?pageSize=30')).status).toBe(422)
  })

  it('keeps mixed search results as projections pointing to canonical resources', async () => {
    const { request, deps } = fixture()
    const response = await request('/api/catalog/items?q=Film&page=3')
    expect(response.status).toBe(200)
    expect(deps.mediaProvider.searchPage.mock.calls[0]).toEqual([
      expect.any(Object),
      { query: 'Film', page: 3, kind: undefined },
    ])
    expect(await response.json()).toMatchObject({
      items: [{ links: { self: 'https://zme.test/api/catalog/movies/550' } }],
      pagination: { page: 1, pageSize: 20 },
    })
  })

  it('resolves season zero and addresses episodes within their series and season', async () => {
    const { request } = fixture()
    const seasons = await request('/api/catalog/series/55/seasons')
    expect(await seasons.json()).toMatchObject({
      items: [{ seasonNumber: 0, links: { self: 'https://zme.test/api/catalog/series/55/seasons/0' } }],
    })
    const episode = await request('/api/catalog/series/55/seasons/0/episodes/1')
    expect(await episode.json()).toMatchObject({
      title: 'Special episode',
      links: { season: 'https://zme.test/api/catalog/series/55/seasons/0' },
    })
    expect((await request('/api/catalog/series/55/seasons/0/episodes/2')).status).toBe(404)
  })

  it('separates person profiles from cast relationships', async () => {
    const { request } = fixture()
    expect(await (await request('/api/catalog/people/7')).json()).toMatchObject({
      id: 7,
      name: 'Person',
      links: { credits: 'https://zme.test/api/catalog/people/7/credits' },
    })
    const credits = await (await request('/api/catalog/people/7/credits')).json()
    expect(credits).toMatchObject({ items: [{ kind: 'cast', media: { id: 550 } }] })
    expect(credits).not.toHaveProperty('person')
  })

  it('lists associated book editions while retaining one canonical edition address', async () => {
    const { request } = fixture()
    const response = await request(`/api/catalog/books/${bookKey}/editions?page=2`)
    expect(await response.json()).toMatchObject({
      items: [
        {
          links: {
            self: `https://zme.test/api/catalog/book-editions/${encodeURIComponent(bookEditionKey)}`,
            book: `https://zme.test/api/catalog/books/${encodeURIComponent(bookKey)}`,
          },
        },
      ],
      pagination: { totalItems: 21 },
    })
    expect((await request(`/api/catalog/books/${bookEditionKey}`)).status).toBe(422)
    const resolved = await (await request('/api/catalog/book-editions?isbn=9780140328721')).json()
    expect(resolved).toMatchObject({ items: [{ mediaKey: bookEditionKey }] })
  })

  it('puts physical discs on an edition, keeping an album independent of its selected edition', async () => {
    const { request } = fixture()
    const resource = await (await request(`/api/catalog/albums/${albumKey}`)).json()
    expect(resource).toMatchObject({
      mediaKey: albumKey,
      preferredEdition: { mediaKey: editionKey, discs: [{ position: 1 }, { position: 2 }] },
    })
    expect(resource).not.toHaveProperty('media')
    expect(resource).not.toHaveProperty('detailMediaKey')
    const first = await (await request(`/api/catalog/album-editions/${editionKey}/discs/1/tracks/1`)).json()
    const second = await (await request(`/api/catalog/album-editions/${editionKey}/discs/2/tracks/1`)).json()
    expect(first).toMatchObject({
      title: 'Recording',
      links: { self: expect.stringContaining('/discs/1/tracks/1'), recording: expect.stringContaining('/recordings/') },
    })
    expect(second).toMatchObject({
      title: 'Another track position',
      links: { self: expect.stringContaining('/discs/2/tracks/1') },
    })
    expect((await request(`/api/catalog/album-editions/${editionKey}/discs/3/tracks`)).status).toBe(404)
    expect((await request(`/api/catalog/albums/${editionKey}`)).status).toBe(422)
  })

  it('addresses recordings independently of the disc positions that reference them', async () => {
    const { request } = fixture()
    const resource = await (await request(`/api/catalog/recordings/${recordingKey}`)).json()
    expect(resource).toMatchObject({
      mediaKey: recordingKey,
      albumEditions: [
        { links: { self: `https://zme.test/api/catalog/album-editions/${encodeURIComponent(editionKey)}` } },
      ],
    })
  })

  it('exposes filters on album collections and omits invented totals', async () => {
    const { request, deps } = fixture()
    const response = await request('/api/catalog/albums?genre=jazz&year=2024&releaseType=ep&pageSize=30')
    expect(deps.musicProvider.search.mock.calls[0]).toEqual([
      expect.objectContaining({ genre: 'jazz', year: '2024', releaseType: 'ep', pageSize: 30 }),
    ])
    expect(await response.json()).toMatchObject({ pagination: { page: 1, pageSize: 30 } })
    expect((await request('/api/catalog/albums?mode=popular')).status).toBe(422)
  })

  it('publishes chart definitions and validates their periods and entry types', async () => {
    const { request } = fixture()
    const definitions = await request('/charts')
    expect(await definitions.json()).toMatchObject({
      items: expect.arrayContaining([
        {
          id: 'album-editions-popular',
          title: expect.any(String),
          itemTypes: ['album-edition'],
          periods: ['week', 'month', 'year', 'all'],
          defaultPeriod: 'all',
          source: 'listenbrainz',
          links: expect.any(Object),
        },
      ]),
    })
    expect((await request('/charts/screen-trending/entries?period=year')).status).toBe(422)
    expect((await request('/charts/movies-popular/entries?genre=jazz')).status).toBe(422)
    expect((await request('/charts/missing/entries')).status).toBe(404)
    const entries = await (await request('/charts/album-editions-popular/entries?period=week')).json()
    expect(entries).toMatchObject({
      items: [
        {
          rank: 1,
          item: { resourceType: 'release', links: { self: expect.stringContaining('/catalog/album-editions/') } },
        },
      ],
      pagination: { page: 1, pageSize: 20 },
    })
    expect(entries).not.toHaveProperty('pagination.totalItems')
  })
})
