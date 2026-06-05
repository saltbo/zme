import { describe, expect, it } from 'vitest'
import { buildMediaKey, buildTmdbMediaKey, getMediaKeyLibraryKind, parseMediaKey, parseTmdbMediaKey } from './media-key'

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
    expect(buildMediaKey({ provider: 'isbn', resourceType: 'book', id: '9780140328721' })).toBe(
      'isbn:book:9780140328721',
    )
    expect(buildMediaKey({ provider: 'openlibrary', resourceType: 'work', id: 'OL45883W' })).toBe(
      'openlibrary:work:OL45883W',
    )
  })

  it('parses provider-prefixed media keys', () => {
    expect(parseMediaKey('tmdb:movie:550')).toEqual({ provider: 'tmdb', resourceType: 'movie', id: '550' })
    expect(parseMediaKey('musicbrainz:release-group:f5093c06-23e3-404f-aeaa-40f72885ee3a')).toEqual({
      provider: 'musicbrainz',
      resourceType: 'release-group',
      id: 'f5093c06-23e3-404f-aeaa-40f72885ee3a',
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

  it('maps supported media keys to library kinds', () => {
    expect(getMediaKeyLibraryKind('tmdb:movie:550')).toBe('movie')
    expect(getMediaKeyLibraryKind('tmdb:tv:1399')).toBe('tv')
    expect(getMediaKeyLibraryKind('musicbrainz:release-group:f5093c06-23e3-404f-aeaa-40f72885ee3a')).toBe('music')
    expect(getMediaKeyLibraryKind('isbn:book:9780140328721')).toBe('book')
    expect(getMediaKeyLibraryKind('openlibrary:work:OL45883W')).toBe('book')
    expect(getMediaKeyLibraryKind('tmdb:person:1')).toBeNull()
    expect(getMediaKeyLibraryKind('not-a-key')).toBeNull()
  })
})
