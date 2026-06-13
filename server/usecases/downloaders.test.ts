import type { CreateDownloadInput } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import { checkDownloaderHealth, submitDownload } from './downloaders'
import type { ConnectorHealthPatch, DownloaderRecord, IndexerRecord, ResolvedDownloadSource } from './ports'

const downloader: DownloaderRecord = {
  id: 'dl-1',
  description: 'ZPan',
  kind: 'zpan',
  config: { endpoint: 'http://zpan.local', credentials: {}, options: {} },
  enabled: true,
  healthStatus: 'online',
  healthMessage: null,
  healthCheckedAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
}

const indexer: IndexerRecord = {
  id: 'idx-1',
  description: 'Prowlarr',
  kind: 'prowlarr',
  config: { endpoint: 'http://prowlarr.local', credentials: { apiKey: 'k' }, options: {} },
  enabled: true,
  healthStatus: 'online',
  healthMessage: null,
  healthCheckedAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
}

const magnetInput: CreateDownloadInput = {
  downloaderId: 'dl-1',
  uri: 'magnet:?xt=urn:btih:abc',
  sourceType: 'magnet',
}

const torrentUrlInput: CreateDownloadInput = {
  downloaderId: 'dl-1',
  uri: 'http://prowlarr.local/1/download?link=abc',
  sourceType: 'torrent_url',
}

function createSubmitDeps(options: {
  matches?: boolean
  resolved?: ResolvedDownloadSource | null
  indexers?: IndexerRecord[]
}) {
  const submit = vi.fn(async () => {})
  const deps = {
    downloadersRepo: {
      getEnabled: async (_userId: string, id: string) => (id === downloader.id ? downloader : null),
    },
    indexersRepo: {
      listEnabled: async () => options.indexers ?? [indexer],
    },
    downloaderGateways: { zpan: { submit, probe: async () => {} } },
    indexerGateways: {
      prowlarr: {
        matchesDownloadUrl: () => options.matches ?? false,
        resolveDownloadSource: async () => options.resolved ?? null,
      },
    },
  }
  return { deps: deps as never as Deps, submit }
}

describe('submitDownload', () => {
  it('fails when the downloader is missing or disabled', async () => {
    const { deps } = createSubmitDeps({})

    await expect(submitDownload(deps, 'user-1', { ...magnetInput, downloaderId: 'other' })).rejects.toThrow(
      'Downloader is not available.',
    )
  })

  it('submits magnet input untouched without consulting indexers', async () => {
    const { deps, submit } = createSubmitDeps({ matches: true, resolved: { uri: 'x', sourceType: 'magnet' } })

    const result = await submitDownload(deps, 'user-1', magnetInput)

    expect(result).toEqual({ downloaderId: 'dl-1', status: 'submitted' })
    expect(submit).toHaveBeenCalledWith(downloader.config, magnetInput)
  })

  it('submits the original torrent url when no indexer serves it', async () => {
    const { deps, submit } = createSubmitDeps({ matches: false })

    await submitDownload(deps, 'user-1', torrentUrlInput)

    expect(submit).toHaveBeenCalledWith(downloader.config, torrentUrlInput)
  })

  it('replaces the source with the resolved one from a matching indexer', async () => {
    const { deps, submit } = createSubmitDeps({
      matches: true,
      resolved: { uri: 'magnet:?xt=urn:btih:resolved', sourceType: 'magnet' },
    })

    await submitDownload(deps, 'user-1', torrentUrlInput)

    expect(submit).toHaveBeenCalledWith(downloader.config, {
      ...torrentUrlInput,
      uri: 'magnet:?xt=urn:btih:resolved',
      sourceType: 'magnet',
    })
  })

  it('fails when matching indexers exist but none can resolve the url', async () => {
    const { deps, submit } = createSubmitDeps({ matches: true, resolved: null })

    await expect(submitDownload(deps, 'user-1', torrentUrlInput)).rejects.toThrow(
      'Prowlarr download URL could not be resolved.',
    )
    expect(submit).not.toHaveBeenCalled()
  })
})

describe('checkDownloaderHealth', () => {
  function createHealthDeps(probe: () => Promise<void>) {
    const patches: ConnectorHealthPatch[] = []
    const deps = {
      downloadersRepo: {
        get: async () => downloader,
        setHealth: async (_userId: string, _id: string, patch: ConnectorHealthPatch) => {
          patches.push(patch)
          return {
            ...downloader,
            healthStatus: patch.status,
            healthMessage: patch.message,
            healthCheckedAt: patch.checkedAt,
          }
        },
      },
      downloaderGateways: { zpan: { submit: async () => {}, probe } },
    }
    return { deps: deps as never as Deps, patches }
  }

  it('persists online status when the probe succeeds', async () => {
    const { deps, patches } = createHealthDeps(async () => {})

    const health = await checkDownloaderHealth(deps, 'user-1', 'dl-1')

    expect(health?.status).toBe('online')
    expect(patches[0]).toMatchObject({ status: 'online', message: 'Connection check succeeded.' })
  })

  it('persists offline status with the probe error message', async () => {
    const { deps, patches } = createHealthDeps(async () => {
      throw new Error('connect ECONNREFUSED')
    })

    const health = await checkDownloaderHealth(deps, 'user-1', 'dl-1')

    expect(health?.status).toBe('offline')
    expect(patches[0]).toMatchObject({ status: 'offline', message: 'connect ECONNREFUSED' })
  })
})
