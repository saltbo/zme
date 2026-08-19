import { describe, expect, it } from 'vitest'
import { getDownloadCatalogResource, getDownloadMedia } from './download-resource'

describe('download resources', () => {
  it('identifies TMDB media from the canonical resource key', () => {
    expect(getDownloadMedia({ resourceKey: 'tmdb:movie:634649' })).toEqual({ kind: 'movie', tmdbId: 634649 })
    expect(getDownloadMedia({ resourceKey: 'tmdb:tv:6560' })).toEqual({ kind: 'tv', tmdbId: 6560 })
  })

  it('identifies catalog resources without downloader tags', () => {
    expect(getDownloadCatalogResource({ category: 'zme:music', resourceKey: 'netease:track:123' })).toEqual({
      kind: 'music',
      mediaKey: 'netease:track:123',
    })
    expect(getDownloadCatalogResource({ category: 'zme:ebook', resourceKey: 'openlibrary:work:OL1W' })).toEqual({
      kind: 'book',
      mediaKey: 'openlibrary:work:OL1W',
    })
  })
})
