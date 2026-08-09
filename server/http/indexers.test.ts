import type { IndexerSearchItem } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { serializeReleaseCandidate } from './indexers'

const secret = 'release-candidate-serialization-test-secret'
const item: IndexerSearchItem = {
  id: 'candidate-1',
  downloadTarget: null,
  title: 'Test Movie 2026 1080p WEB-DL',
  fileName: 'test-movie.torrent',
  indexer: 'Private Indexer',
  size: 1_000,
  seeders: 10,
  leechers: 1,
  files: 1,
  protocol: 'torrent',
  publishDate: null,
  downloadUrl: 'https://example.test/test-movie.torrent',
  magnetUrl: null,
  infoUrl: null,
  infoHash: 'abc',
  categories: ['Movies'],
  categoryIds: [2000],
  indexerFlags: [],
  imdbId: null,
  tmdbId: 123,
  tvdbId: null,
}

describe('release candidate serialization', () => {
  it('omits the indexer from the default compact view', async () => {
    const candidate = await serializeReleaseCandidate(secret, 'user-1', 'tmdb:movie:123', item, undefined, 'compact')

    expect(candidate).not.toHaveProperty('indexer')
  })

  it('includes the indexer in the full view', async () => {
    const candidate = await serializeReleaseCandidate(secret, 'user-1', 'tmdb:movie:123', item, undefined, 'full')

    expect(candidate).toHaveProperty('indexer', 'Private Indexer')
  })
})
