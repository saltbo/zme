import type { IndexerSearchItem } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  InvalidDownloadResourceRefError,
  issueReleaseResourceRef,
  resolveReleaseResourceRef,
} from './download-resource-ref'

const secret = 'independent-download-resource-reference-test-secret'
const item: IndexerSearchItem = {
  id: 'candidate-1',
  downloadTarget: null,
  title: 'Last Resort S01',
  fileName: null,
  indexer: 'test',
  size: 1,
  seeders: 1,
  leechers: 0,
  files: 1,
  protocol: 'torrent',
  publishDate: null,
  downloadUrl: null,
  magnetUrl: 'magnet:?xt=urn:btih:abc',
  infoUrl: null,
  infoHash: 'abc',
  categories: [],
  categoryIds: [],
  indexerFlags: [],
  imdbId: null,
  tmdbId: 44652,
  tvdbId: null,
}

describe('download resource references', () => {
  it('round-trips a one-hour user-bound encrypted release reference', async () => {
    const now = new Date()
    const issued = await issueReleaseResourceRef(secret, 'user-1', 'tmdb:tv:44652', item, now)
    expect(issued.candidateId).toMatch(/^release-candidate:[0-9a-f]{64}$/)
    expect(issued.candidateId).not.toContain(item.id)
    expect(issued.sourceType).toBe('magnet')
    expect(issued.resourceRef).toMatch(/^release-ref:v1:/)
    expect(issued.resourceRef).not.toContain(item.magnetUrl)
    expect(Date.parse(issued.resourceRefExpiresAt) - now.getTime()).toBe(60 * 60 * 1000)
    await expect(resolveReleaseResourceRef(secret, 'user-1', issued.resourceRef)).resolves.toMatchObject({
      uri: item.magnetUrl,
      category: 'zme:series',
      mediaKey: 'tmdb:tv:44652',
    })
  })

  it('keeps candidate identity stable for the same user, media, and source', async () => {
    const first = await issueReleaseResourceRef(secret, 'user-1', 'tmdb:tv:44652', item)
    const second = await issueReleaseResourceRef(secret, 'user-1', 'tmdb:tv:44652', item)

    expect(second.candidateId).toBe(first.candidateId)
    expect(second.resourceRef).not.toBe(first.resourceRef)
  })

  it('uses the magnet info hash for stable identity when providers use different GUIDs', async () => {
    const first = await issueReleaseResourceRef(secret, 'user-1', 'tmdb:tv:44652', {
      ...item,
      id: 'provider-guid-1',
      infoHash: null,
    })
    const second = await issueReleaseResourceRef(secret, 'user-1', 'tmdb:tv:44652', {
      ...item,
      id: 'provider-guid-2',
      infoHash: null,
      magnetUrl: 'magnet:?dn=Last.Resort&xt=urn:btih:ABC',
    })

    expect(second.candidateId).toBe(first.candidateId)
  })

  it('rejects references owned by another user or modified by the client', async () => {
    const issued = await issueReleaseResourceRef(secret, 'user-1', 'tmdb:tv:44652', item)
    await expect(resolveReleaseResourceRef(secret, 'user-2', issued.resourceRef)).rejects.toBeInstanceOf(
      InvalidDownloadResourceRefError,
    )
    const position = issued.resourceRef.length - 20
    const replacement = issued.resourceRef[position] === 'x' ? 'y' : 'x'
    const tampered = `${issued.resourceRef.slice(0, position)}${replacement}${issued.resourceRef.slice(position + 1)}`
    await expect(resolveReleaseResourceRef(secret, 'user-1', tampered)).rejects.toBeInstanceOf(
      InvalidDownloadResourceRefError,
    )
  })

  it('rejects expired and unknown reference versions', async () => {
    const expired = await issueReleaseResourceRef(
      secret,
      'user-1',
      'tmdb:tv:44652',
      item,
      new Date(Date.now() - 2 * 60 * 60 * 1000),
    )
    await expect(resolveReleaseResourceRef(secret, 'user-1', expired.resourceRef)).rejects.toBeInstanceOf(
      InvalidDownloadResourceRefError,
    )
    await expect(resolveReleaseResourceRef(secret, 'user-1', 'release-ref:v2:opaque')).rejects.toBeInstanceOf(
      InvalidDownloadResourceRefError,
    )
  })
})
