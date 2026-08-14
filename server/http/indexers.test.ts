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
  it('omits the indexer and resource reference from the default compact view', async () => {
    const candidate = await serializeReleaseCandidate(secret, 'user-1', 'tmdb:movie:123', item, undefined, 'compact')

    expect(candidate).not.toHaveProperty('indexer')
    expect(candidate).not.toHaveProperty('resourceRef')
    expect(candidate.links.self).toMatch(/^\/api\/release-candidates\/release-candidate:/)
  })

  it('includes the indexer in the full view without exposing the resource reference', async () => {
    const candidate = await serializeReleaseCandidate(secret, 'user-1', 'tmdb:movie:123', item, undefined, 'full')

    expect(candidate).toHaveProperty('indexer', 'Private Indexer')
    expect(candidate).not.toHaveProperty('resourceRef')
  })

  it('includes the resource reference only for direct candidate retrieval', async () => {
    const candidate = await serializeReleaseCandidate(secret, 'user-1', 'tmdb:movie:123', item, undefined, 'compact', {
      includeResourceRef: true,
    })

    expect(candidate.resourceRef).toMatch(/^release-ref:v1:/)
    expect(candidate.resourceRefExpiresAt).toEqual(expect.any(String))
  })
})
