import { describe, expect, it } from 'vitest'
import { buildTitleSearches, filterExactMediaMatches } from './indexer-search'
import type { IndexerSearchItem } from './types'

describe('media indexer search planning', () => {
  it('keeps more title aliases for multilingual release searches', () => {
    const searches = buildTitleSearches({
      query: '流浪地球 2019',
      title: '流浪地球',
      aliases: [
        'The Wandering Earth',
        'Liu Lang Di Qiu',
        'Wandering Earth',
        '流浪地球1',
        'The Wandering Earth 1',
        'Chinese Sci-Fi Movie',
        'Earth Rescue',
      ],
      year: '2019',
    })

    expect(searches.map((item) => item.query)).toEqual([
      '流浪地球 2019',
      'The Wandering Earth 2019',
      'Liu Lang Di Qiu 2019',
      'Wandering Earth 2019',
      '流浪地球1 2019',
      'The Wandering Earth 1 2019',
      'Chinese Sci-Fi Movie 2019',
      'Earth Rescue 2019',
    ])
  })

  it('does not drop title matches only because the release title omits the year', () => {
    const results = filterExactMediaMatches([release('cn-release', '流浪地球 WEB-DL 1080p')], {
      query: '流浪地球 2019',
      title: '流浪地球',
      aliases: ['The Wandering Earth'],
      year: '2019',
      kind: 'movie',
    })

    expect(results.map((item) => item.id)).toEqual(['cn-release'])
  })
})

function release(id: string, title: string): IndexerSearchItem {
  return {
    id,
    downloadTarget: null,
    title,
    fileName: null,
    indexer: 'Indexer',
    size: null,
    seeders: null,
    leechers: null,
    files: null,
    protocol: null,
    publishDate: null,
    downloadUrl: null,
    magnetUrl: null,
    infoUrl: null,
    infoHash: null,
    categories: [],
    categoryIds: [],
    indexerFlags: [],
    imdbId: null,
    tmdbId: null,
    tvdbId: null,
  }
}
