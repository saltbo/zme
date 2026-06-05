import { describe, expect, it } from 'vitest'
import {
  buildMediaKey,
  buildMusicBrainzMediaKey,
  buildTmdbMediaKey,
  getMediaKeyLibraryKind,
  parseMediaKey,
  parseMusicBrainzMediaKey,
  parseTmdbMediaKey,
} from './media-key'

describe('media key helpers', () => {
  it('builds provider-prefixed media keys', () => {
    expect(buildTmdbMediaKey('movie', 550)).toBe('tmdb:movie:550')
    expect(buildTmdbMediaKey('tv', 1399)).toBe('tmdb:tv:1399')
    expect(
      buildMediaKey({
        provider: 'musicbrainz',
        resourceType: 'release-group',
        id: 'f5093c06-23e3-404f-aeaa-40f72885ee3a',
      }),
    ).toBe('musicbrainz:release-group:f5093c06-23e3-404f-aeaa-40f72885ee3a')
    expect(
      buildMediaKey({
        provider: 'musicbrainz',
        resourceType: 'release',
        id: '59211ea4-fb59-49dd-a69e-83d1666a1aa5',
      }),
    ).toBe('musicbrainz:release:59211ea4-fb59-49dd-a69e-83d1666a1aa5')
    expect(buildMusicBrainzMediaKey('recording', '8f88cc68-4fe2-4f4d-9b0f-ff3d06dba042')).toBe(
      'musicbrainz:recording:8f88cc68-4fe2-4f4d-9b0f-ff3d06dba042',
    )
    expect(buildMediaKey({ provider: 'isbn', resourceType: 'book', id: '9780140328721' })).toBe(
      'isbn:book:9780140328721',
    )
    expect(buildMediaKey({ provider: 'openlibrary', resourceType: 'work', id: 'OL45883W' })).toBe(
      'openlibrary:work:OL45883W',
    )
    expect(buildMediaKey({ provider: 'openlibrary', resourceType: 'edition', id: 'OL7353617M' })).toBe(
      'openlibrary:edition:OL7353617M',
    )
  })

  it('parses provider-prefixed media keys', () => {
    expect(parseMediaKey('tmdb:movie:550')).toEqual({ provider: 'tmdb', resourceType: 'movie', id: '550' })
    expect(parseMediaKey('musicbrainz:release-group:f5093c06-23e3-404f-aeaa-40f72885ee3a')).toEqual({
      provider: 'musicbrainz',
      resourceType: 'release-group',
      id: 'f5093c06-23e3-404f-aeaa-40f72885ee3a',
    })
    expect(parseMediaKey('musicbrainz:release:59211ea4-fb59-49dd-a69e-83d1666a1aa5')).toEqual({
      provider: 'musicbrainz',
      resourceType: 'release',
      id: '59211ea4-fb59-49dd-a69e-83d1666a1aa5',
    })
    expect(parseMediaKey('isbn:book:9780140328721')).toEqual({
      provider: 'isbn',
      resourceType: 'book',
      id: '9780140328721',
    })
    expect(parseMediaKey('openlibrary:work:OL45883W')).toEqual({
      provider: 'openlibrary',
      resourceType: 'work',
      id: 'OL45883W',
    })
    expect(parseMediaKey('openlibrary:edition:OL7353617M')).toEqual({
      provider: 'openlibrary',
      resourceType: 'edition',
      id: 'OL7353617M',
    })
  })

  it('rejects malformed media keys', () => {
    expect(parseMediaKey('movie:550')).toBeNull()
    expect(parseMediaKey('tmdb::550')).toBeNull()
    expect(parseMediaKey('tmdb:movie:')).toBeNull()
    expect(parseMediaKey('tmdb:movie:550:extra')).toBeNull()
  })

  it('parses only valid tmdb movie and tv keys', () => {
    expect(parseTmdbMediaKey('tmdb:movie:550')).toEqual({ kind: 'movie', tmdbId: 550 })
    expect(parseTmdbMediaKey('tmdb:tv:1399')).toEqual({ kind: 'tv', tmdbId: 1399 })
    expect(parseTmdbMediaKey('tmdb:person:1')).toBeNull()
    expect(parseTmdbMediaKey('tmdb:movie:abc')).toBeNull()
    expect(parseTmdbMediaKey('tmdb:movie:001')).toBeNull()
  })

  it('parses musicbrainz entity keys', () => {
    expect(parseMusicBrainzMediaKey('musicbrainz:release-group:f5093c06-23e3-404f-aeaa-40f72885ee3a')).toEqual({
      resourceType: 'release-group',
      mbid: 'f5093c06-23e3-404f-aeaa-40f72885ee3a',
    })
    expect(parseMusicBrainzMediaKey('musicbrainz:release:59211ea4-fb59-49dd-a69e-83d1666a1aa5')).toEqual({
      resourceType: 'release',
      mbid: '59211ea4-fb59-49dd-a69e-83d1666a1aa5',
    })
    expect(parseMusicBrainzMediaKey('musicbrainz:recording:8f88cc68-4fe2-4f4d-9b0f-ff3d06dba042')).toEqual({
      resourceType: 'recording',
      mbid: '8f88cc68-4fe2-4f4d-9b0f-ff3d06dba042',
    })
    expect(parseMusicBrainzMediaKey('musicbrainz:release:not-a-uuid')).toBeNull()
    expect(parseMusicBrainzMediaKey('musicbrainz:artist:5441c29d-3602-4898-b1a1-b77fa23b8e50')).toBeNull()
  })

  it('maps supported media keys to library kinds', () => {
    expect(getMediaKeyLibraryKind('tmdb:movie:550')).toBe('movie')
    expect(getMediaKeyLibraryKind('tmdb:tv:1399')).toBe('tv')
    expect(getMediaKeyLibraryKind('musicbrainz:release-group:f5093c06-23e3-404f-aeaa-40f72885ee3a')).toBe('music')
    expect(getMediaKeyLibraryKind('musicbrainz:release:59211ea4-fb59-49dd-a69e-83d1666a1aa5')).toBe('music')
    expect(getMediaKeyLibraryKind('isbn:book:9780140328721')).toBe('book')
    expect(getMediaKeyLibraryKind('openlibrary:work:OL45883W')).toBe('book')
    expect(getMediaKeyLibraryKind('openlibrary:edition:OL7353617M')).toBe('book')
    expect(getMediaKeyLibraryKind('tmdb:person:1')).toBeNull()
    expect(getMediaKeyLibraryKind('musicbrainz:release:not-a-uuid')).toBeNull()
    expect(getMediaKeyLibraryKind('musicbrainz:recording:8f88cc68-4fe2-4f4d-9b0f-ff3d06dba042')).toBeNull()
    expect(getMediaKeyLibraryKind('not-a-key')).toBeNull()
  })
})
