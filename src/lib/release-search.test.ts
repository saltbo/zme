import { describe, expect, it, vi } from 'vitest'
import { searchIndexerOnce } from '@/lib/api'
import { searchMediaReleasesInSteps } from './release-search'

vi.mock('@/lib/api', () => ({
  searchIndexerOnce: vi.fn(),
}))

describe('release search orchestration', () => {
  it('runs indexer searches with a concurrency limit of three', async () => {
    let active = 0
    let maxActive = 0
    vi.mocked(searchIndexerOnce).mockImplementation(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active -= 1
      return { results: [] }
    })

    await searchMediaReleasesInSteps(
      {
        query: 'Title 2026',
        title: 'Title',
        aliases: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
        year: '2026',
      },
      () => undefined,
    )

    expect(searchIndexerOnce).toHaveBeenCalledTimes(8)
    expect(maxActive).toBeLessThanOrEqual(3)
  })
})
