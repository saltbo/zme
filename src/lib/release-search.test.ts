import type { IndexerSearchItem } from '@shared/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchIndexerOnce } from '@/lib/api'
import { automaticReleaseResultLimit, searchMediaReleasesInSteps } from './release-search'

vi.mock('@/lib/api', () => ({
  searchIndexerOnce: vi.fn(),
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('release search orchestration', () => {
  it('searches the original and English titles first and stops when they find enough valid releases', async () => {
    vi.mocked(searchIndexerOnce).mockImplementation(async ({ query }) => ({
      results:
        query === 'Original Title 2026'
          ? releases('Original Title', automaticReleaseResultLimit)
          : releases('English Title', automaticReleaseResultLimit, 100),
    }))

    const outcome = await searchMediaReleasesInSteps(mediaInput(), () => undefined)

    expect(vi.mocked(searchIndexerOnce).mock.calls.map(([input]) => input.query)).toEqual([
      'Original Title 2026',
      'English Title 2026',
    ])
    expect(outcome.items).toHaveLength(automaticReleaseResultLimit * 2)
    expect(outcome.stoppedEarly).toBe(true)
  })

  it('uses one preferred query when the original and English titles are the same', async () => {
    vi.mocked(searchIndexerOnce).mockResolvedValue({
      results: releases('Original Title', automaticReleaseResultLimit),
    })

    const outcome = await searchMediaReleasesInSteps(
      {
        ...mediaInput(),
        englishTitle: 'Original Title',
        localizedTitle: 'Original Title',
      },
      () => undefined,
    )

    expect(searchIndexerOnce).toHaveBeenCalledOnce()
    expect(searchIndexerOnce).toHaveBeenCalledWith({ query: 'Original Title 2026' })
    expect(outcome.items).toHaveLength(automaticReleaseResultLimit)
    expect(outcome.stoppedEarly).toBe(true)
  })

  it('searches supplemental titles two at a time and stops before remaining aliases', async () => {
    let active = 0
    let maxActive = 0
    vi.mocked(searchIndexerOnce).mockImplementation(async ({ query }) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await Promise.resolve()
      active -= 1
      if (query === 'Original Title 2026') return { results: releases('Original Title', 1) }
      if (query === 'English Title 2026') return { results: releases('English Title', 15, 100) }
      if (query === '本地标题 2026') return { results: releases('本地标题', 15, 200) }
      return { results: [] }
    })

    const outcome = await searchMediaReleasesInSteps(mediaInput(), () => undefined)

    expect(searchIndexerOnce).toHaveBeenCalledTimes(4)
    expect(vi.mocked(searchIndexerOnce).mock.calls.map(([input]) => input.query)).toEqual([
      'Original Title 2026',
      'English Title 2026',
      '本地标题 2026',
      'Alias One 2026',
    ])
    expect(maxActive).toBe(2)
    expect(outcome.items).toHaveLength(31)
    expect(outcome.stoppedEarly).toBe(true)
  })

  it('searches every title only when exhaustive search is requested', async () => {
    vi.mocked(searchIndexerOnce).mockResolvedValue({ results: [] })

    const outcome = await searchMediaReleasesInSteps(mediaInput(), () => undefined, { exhaustive: true })

    expect(vi.mocked(searchIndexerOnce).mock.calls.map(([input]) => input.query)).toEqual([
      'Original Title 2026',
      'English Title 2026',
      '本地标题 2026',
      'Alias One 2026',
      'Alias Two 2026',
    ])
    expect(outcome.stoppedEarly).toBe(false)
  })

  it('reports only newly accepted and deduplicated results for each search step', async () => {
    const duplicate = release('duplicate', 'Original Title 2026 1080p')
    duplicate.infoHash = 'ABC'
    const sameHash = release('other-id', '本地标题 2026 1080p')
    sameHash.infoHash = 'abc'
    vi.mocked(searchIndexerOnce)
      .mockResolvedValueOnce({ results: [duplicate] })
      .mockResolvedValueOnce({ results: [sameHash] })
      .mockResolvedValue({ results: [] })
    const counts: number[] = []

    await searchMediaReleasesInSteps(mediaInput(), (progress) => {
      const completed = progress.steps.find((step) => step.status === 'completed')
      if (completed?.resultCount != null) counts.push(completed.resultCount)
    })

    expect(counts).toContain(1)
    expect(counts).toContain(0)
  })
})

function mediaInput() {
  return {
    query: 'Original Title 2026',
    title: 'Original Title',
    originalTitle: 'Original Title',
    localizedTitle: '本地标题',
    englishTitle: 'English Title',
    aliases: ['Alias One', 'Alias Two'],
    year: '2026',
    kind: 'movie' as const,
  }
}

function releases(title: string, count: number, offset = 0) {
  return Array.from({ length: count }, (_, index) =>
    release(`release-${offset + index}`, `${title} 2026 1080p WEB-DL ${offset + index}`),
  )
}

function release(id: string, title: string): IndexerSearchItem {
  return {
    id,
    downloadTarget: null,
    title,
    fileName: null,
    indexer: 'Test',
    size: 1_000,
    seeders: 1,
    leechers: 0,
    files: 1,
    protocol: 'torrent',
    publishDate: null,
    downloadUrl: `https://example.test/${id}.torrent`,
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
