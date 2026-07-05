import type { BookDetails, MediaDetails, MusicAlbumDetails } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  getBookReleaseSearchInput,
  getMediaReleaseSearchInput,
  getMusicReleaseSearchInput,
} from '@/lib/release-search-context'

describe('media release search inputs', () => {
  it('preserves movie external identifiers for exact indexer matching', () => {
    const input = getMediaReleaseSearchInput(movieFixture)

    expect(input).toMatchObject({
      query: 'The Matrix 1999',
      title: 'The Matrix',
      aliases: ['Matrix'],
      year: '1999',
      kind: 'movie',
      tmdbId: 603,
      imdbId: 'tt0133093',
      tvdbId: undefined,
      label: 'IMDb tt0133093',
    })
  })

  it('uses TVDB as the series release search label when available', () => {
    const input = getMediaReleaseSearchInput(seriesFixture)

    expect(input).toMatchObject({
      query: 'Game of Thrones 2011',
      title: 'Game of Thrones',
      year: '2011',
      kind: 'tv',
      tmdbId: 1399,
      imdbId: 'tt0944947',
      tvdbId: 121361,
      label: 'TVDB 121361',
    })
    expect(input.aliases).toEqual(expect.arrayContaining(['Game of Thrones', 'A Song of Ice and Fire']))
  })
})

describe('resource release search inputs', () => {
  it('builds target-aware music download metadata', () => {
    const input = getMusicReleaseSearchInput(musicAlbumFixture)

    expect(input).toMatchObject({
      target: 'music',
      title: 'Kind of Blue',
      creators: ['Miles Davis'],
      year: '1959',
      narrator: null,
    })
    expect(input.query).toContain('Kind of Blue')
    expect(input.formats).toEqual(expect.arrayContaining(['Vinyl', 'Jazz', 'flac', 'mp3']))
    expect(input.aliases).toEqual(expect.arrayContaining(['Blue Sessions', 'Kind of Blue Legacy']))
    expect(input.item).toMatchObject({
      title: 'Kind of Blue',
      downloadCategory: 'zme:music',
      downloadTags: ['mediaKey=musicbrainz:release-group:89ad4ac3-39f7-470e-963a-56509c546377', 'kind=music'],
    })
  })

  it('builds ebook metadata with book creators and ebook formats', () => {
    const input = getBookReleaseSearchInput(bookFixture, 'ebook')

    expect(input).toMatchObject({
      target: 'ebook',
      title: 'Matilda',
      creators: ['Roald Dahl'],
      year: '1988',
      narrator: null,
    })
    expect(input.query).toBe('Matilda Roald Dahl 1988 ebook')
    expect(input.formats).toEqual(['ebook', 'epub', 'mobi', 'azw3', 'pdf'])
    expect(input.aliases).toEqual(['Matilda, or, The Child Genius'])
    expect(input.item).toMatchObject({
      title: 'Matilda',
      downloadCategory: 'zme:ebook',
      downloadTags: ['mediaKey=isbn:book:9780140328721', 'kind=book', 'target=ebook'],
    })
  })

  it('builds audiobook metadata with audiobook formats', () => {
    const input = getBookReleaseSearchInput(bookFixture, 'audiobook')

    expect(input).toMatchObject({
      target: 'audiobook',
      title: 'Matilda',
      creators: ['Roald Dahl'],
      year: '1988',
    })
    expect(input.query).toBe('Matilda Roald Dahl 1988 audiobook')
    expect(input.formats).toEqual(['audiobook', 'm4b', 'm4a', 'mp3'])
    expect(input.item).toMatchObject({
      title: 'Matilda',
      downloadCategory: 'zme:audiobook',
      downloadTags: ['mediaKey=isbn:book:9780140328721', 'kind=book', 'target=audiobook'],
    })
  })
})

const movieFixture: MediaDetails = {
  id: 603,
  kind: 'movie',
  title: 'The Matrix',
  originalTitle: 'Matrix',
  overview: 'A hacker discovers the nature of reality.',
  posterUrl: null,
  backdropUrl: null,
  releaseYear: '1999',
  rating: 8.2,
  genres: ['Action', 'Science Fiction'],
  aliases: ['Matrix'],
  tagline: null,
  status: 'Released',
  homepage: null,
  runtime: '136 min',
  language: 'en',
  country: 'US',
  director: 'The Wachowskis',
  writers: ['Lana Wachowski', 'Lilly Wachowski'],
  cast: [],
  watch: null,
  videos: [],
  images: [],
  recommendations: [],
  similar: [],
  seasons: [],
  releaseInfo: null,
  ids: {
    tmdb: '603',
    imdb: 'tt0133093',
    tvdb: null,
  },
}

const seriesFixture: MediaDetails = {
  ...movieFixture,
  id: 1399,
  kind: 'tv',
  title: 'Game of Thrones',
  originalTitle: 'Game of Thrones',
  overview: 'Noble families fight for control of Westeros.',
  releaseYear: '2011',
  rating: 8.4,
  aliases: ['A Song of Ice and Fire'],
  director: null,
  writers: [],
  ids: {
    tmdb: '1399',
    imdb: 'tt0944947',
    tvdb: '121361',
  },
}

const musicAlbumFixture: MusicAlbumDetails = {
  mediaKey: 'musicbrainz:release-group:89ad4ac3-39f7-470e-963a-56509c546377',
  provider: 'musicbrainz',
  resourceType: 'release-group',
  mbid: '89ad4ac3-39f7-470e-963a-56509c546377',
  releaseGroupMbid: '89ad4ac3-39f7-470e-963a-56509c546377',
  title: 'Kind of Blue',
  artist: 'Miles Davis',
  artists: [{ id: '561d854a-6a28-4aa7-8c99-323e6ce46c2a', name: 'Miles Davis', joinPhrase: '' }],
  firstReleaseDate: '1959-08-17',
  releaseYear: '1959',
  releaseDate: '1959-08-17',
  country: 'US',
  primaryType: 'Album',
  secondaryTypes: ['Jazz'],
  disambiguation: null,
  coverArt: { frontUrl: null, frontThumbnailUrl: null, backUrl: null, backThumbnailUrl: null },
  detailMediaKey: 'musicbrainz:release:00000000-0000-0000-0000-000000000001',
  releaseMbid: '00000000-0000-0000-0000-000000000001',
  preferredRelease: null,
  releases: [
    {
      mediaKey: 'musicbrainz:release:00000000-0000-0000-0000-000000000001',
      mbid: '00000000-0000-0000-0000-000000000001',
      title: 'Kind of Blue Legacy',
      date: '1959-08-17',
      country: 'US',
      status: 'Official',
      barcode: null,
      formats: ['Vinyl'],
    },
  ],
  barcode: null,
  aliases: [{ name: 'Blue Sessions', locale: null, primary: false, type: null }],
  formats: ['Vinyl'],
  media: [],
}

const bookFixture: BookDetails = {
  mediaKey: 'isbn:book:9780140328721',
  title: 'Matilda',
  authors: ['Roald Dahl'],
  languages: ['eng'],
  firstPublishYear: 1988,
  coverUrl: null,
  isbnCandidates: ['9780140328721'],
  editionKeys: ['OL7353617M'],
  aliases: ['Matilda, or, The Child Genius'],
  description: 'A clever child loves books.',
  covers: [],
  workKey: 'openlibrary:work:OL45883W',
  editionKey: 'openlibrary:edition:OL7353617M',
  editionCandidates: [],
}
