import type { BookDetails, MusicAlbumDetails } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { getBookReleaseSearchInput, getMusicReleaseSearchInput } from '@/routes/resource-pages'

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
  })
})

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
