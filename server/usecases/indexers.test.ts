import { prowlarrIndexerGateway } from '@server/adapters/gateways/prowlarr'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import { deleteIndexer, getIndexerHealth, searchIndexers, updateIndexer } from './indexers'
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

it('applies indexer mutations against the latest record', async () => {
  const update = vi.fn(async () => indexer)
  const remove = vi.fn(async () => true)
  const deps = { indexersRepo: { get: async () => indexer, update, delete: remove } } as never as Deps
  const input = {
    kind: 'prowlarr' as const,
    endpoint: 'https://prowlarr.test',
    credentials: { apiKey: 'key' },
    options: {},
    enabled: true,
  }

  await expect(updateIndexer(deps, 'indexer-1', input)).resolves.toMatchObject({ id: 'indexer-1' })
  await expect(deleteIndexer(deps, 'indexer-1')).resolves.toBe(true)
  expect(update).toHaveBeenCalledWith(
    'indexer-1',
    { ...input, description: indexer.description ?? undefined },
    indexer.updatedAt,
  )
  expect(remove).toHaveBeenCalledWith('indexer-1', indexer.updatedAt)
})

it('reports a failed Prowlarr health response', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 503 })),
  )
  await expect(prowlarrIndexerGateway.probe(indexer.config)).rejects.toThrow('Prowlarr request failed with status 503.')
  vi.unstubAllGlobals()
})

it('reads the latest cached indexer health without probing', async () => {
  await expect(
    getIndexerHealth(
      { indexersRepo: { get: async () => ({ ...indexer, healthStatus: 'unknown' }) } } as never,
      'indexer-1',
    ),
  ).resolves.toEqual({ status: 'unknown', message: null, checkedAt: null })
  await expect(getIndexerHealth({ indexersRepo: { get: async () => null } } as never, 'missing')).resolves.toBeNull()
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
