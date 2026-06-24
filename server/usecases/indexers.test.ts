import { prowlarrIndexerGateway } from '@server/adapters/gateways/prowlarr'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import { searchIndexers } from './indexers'
import type { IndexerRecord } from './ports'

const indexer: IndexerRecord = {
  id: 'indexer-1',
  description: 'Prowlarr',
  kind: 'prowlarr',
  config: {
    endpoint: 'http://prowlarr.local',
    credentials: { apiKey: 'secret' },
    options: {},
  },
  enabled: true,
  healthStatus: 'online',
  healthMessage: null,
  healthCheckedAt: null,
  createdAt: '2026-06-04T00:00:00.000Z',
  updatedAt: '2026-06-04T00:00:00.000Z',
}

describe('searchIndexers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('runs one atomic search against enabled indexers', async () => {
    const fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            {
              guid: 'release-1',
              title: 'Dune 2021 1080p',
              categories: [{ id: 2040, name: 'Movies/HD' }],
            },
          ]),
          { status: 200 },
        ),
      ),
    )
    vi.stubGlobal('fetch', fetch)

    const results = await searchIndexers(createDepsWithIndexers([indexer]), {
      query: 'Dune 2021',
      searchType: 'search',
      categories: [2000, 2040],
    })

    expect(results.map((item) => item.id)).toEqual(['release-1'])
    expect(fetch).toHaveBeenCalledTimes(1)

    const url = new URL(fetch.mock.calls[0][0].toString())
    expect(url.searchParams.get('query')).toBe('Dune 2021')
    expect(url.searchParams.get('type')).toBe('search')
    expect(url.searchParams.getAll('categories')).toEqual(['2000', '2040'])
  })
})

function createDepsWithIndexers(indexers: IndexerRecord[]): Deps {
  return {
    indexersRepo: {
      list: async () => indexers,
      get: async () => null,
      listEnabled: async () => indexers,
      create: async () => indexers[0],
      update: async () => null,
      delete: async () => false,
      setHealth: async () => null,
    },
    indexerGateways: {
      prowlarr: prowlarrIndexerGateway,
    },
  } as unknown as Deps
}
