import type { BookDetails, MediaDetails } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { getBookReleaseSearchInput, getMediaReleaseSearchInput } from '@/lib/release-search-context'

describe('media release search inputs', () => {
  it('preserves movie external identifiers for exact indexer matching', () => {
    const input = getMediaReleaseSearchInput(movieFixture)

    expect(input).toMatchObject({
      query: 'Matrix 1999',
      title: 'Matrix',
      originalTitle: 'Matrix',
      localizedTitle: 'The Matrix',
      aliases: ['Matrix'],
      year: '1999',
      kind: 'movie',
      tmdbId: 603,
      imdbId: 'tt0133093',
      tvdbId: undefined,
      label: 'Matrix 1999',
    })
  })

  it('uses the original series title as the release search label', () => {
    const input = getMediaReleaseSearchInput(seriesFixture)

    expect(input).toMatchObject({
      query: 'Game of Thrones 2011',
      title: 'Game of Thrones',
      year: '2011',
      kind: 'tv',
      tmdbId: 1399,
      imdbId: 'tt0944947',
      tvdbId: 121361,
      label: 'Game of Thrones 2011',
    })
    expect(input.aliases).toEqual(['A Song of Ice and Fire'])
  })
})

describe('resource release search inputs', () => {
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
  englishTitle: 'The Matrix',
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
