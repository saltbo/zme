import type { CreateDownloadInput } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import {
  checkDownloaderHealth,
  deleteDownloader,
  getDownloaderHealth,
  submitDownload,
  updateDownloader,
} from './downloaders'
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

const httpInput: CreateDownloadInput = {
  downloaderId: 'dl-1',
  uri: 'https://zme.test/api/music/tracks/track-1/content?key=temporary',
  sourceType: 'http',
}

it('applies downloader mutations with the expected revision', async () => {
  const update = vi.fn(async () => downloader)
  const remove = vi.fn(async () => true)
  const deps = {
    downloadersRepo: { get: async () => downloader, update, delete: remove },
    downloaderGateways: { zpan: { supportedSourceTypes: ['magnet'] } },
  } as never as Deps
  const input = { kind: 'zpan' as const, endpoint: 'https://zpan.test', credentials: {}, options: {}, enabled: true }

  await expect(updateDownloader(deps, 'user-1', 'dl-1', input, 'revision-1')).resolves.toMatchObject({ id: 'dl-1' })
  await expect(deleteDownloader(deps, 'user-1', 'dl-1', 'revision-2')).resolves.toBe(true)
  expect(update).toHaveBeenCalledWith('user-1', 'dl-1', { ...input, description: 'ZPan' }, 'revision-1')
  expect(remove).toHaveBeenCalledWith('user-1', 'dl-1', 'revision-2')
})

function createSubmitDeps(options: {
  matches?: boolean
  resolved?: ResolvedDownloadSource | null
  resolveError?: Error
  indexers?: IndexerRecord[]
}) {
  const submit = vi.fn(async () => ({ externalTaskId: null }))
  const deps = {
    downloadersRepo: {
      getEnabled: async (_userId: string, id: string) => (id === downloader.id ? downloader : null),
    },
    indexersRepo: {
      listEnabled: async () => options.indexers ?? [indexer],
    },
    downloaderGateways: {
      zpan: { supportedSourceTypes: ['magnet', 'torrent_url', 'http'], submit, probe: async () => {} },
    },
    indexerGateways: {
      prowlarr: {
        matchesDownloadUrl: () => options.matches ?? false,
        resolveDownloadSource: async () => {
          if (options.resolveError) throw options.resolveError
          return options.resolved ?? null
        },
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

    expect(result).toEqual({ downloaderId: 'dl-1', status: 'submitted', externalTaskId: null })
    expect(submit).toHaveBeenCalledWith(downloader.config, magnetInput)
  })

  it('submits HTTP files directly to a compatible downloader', async () => {
    const { deps, submit } = createSubmitDeps({})

    await submitDownload(deps, 'user-1', httpInput)

    expect(submit).toHaveBeenCalledWith(downloader.config, httpInput)
  })

  it('rejects HTTP files for torrent-only downloaders', async () => {
    const torrentDownloader = { ...downloader, kind: 'qbittorrent' as const }
    const deps = {
      downloadersRepo: { getEnabled: async () => torrentDownloader },
      downloaderGateways: {
        qbittorrent: { supportedSourceTypes: ['magnet', 'torrent_url'], submit: vi.fn(), probe: async () => {} },
      },
    } as never as Deps

    await expect(submitDownload(deps, 'user-1', httpInput)).rejects.toThrow(
      'qbittorrent does not support HTTP file downloads.',
    )
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

  it('preserves the concrete indexer resolution error', async () => {
    const { deps, submit } = createSubmitDeps({
      matches: true,
      resolveError: new Error('Prowlarr download URL returned HTTP 401 Unauthorized.'),
    })

    await expect(submitDownload(deps, 'user-1', torrentUrlInput)).rejects.toThrow(
      'Prowlarr download URL returned HTTP 401 Unauthorized.',
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
      downloaderGateways: {
        zpan: {
          supportedSourceTypes: ['magnet', 'torrent_url', 'http'],
          submit: async () => ({ externalTaskId: null }),
          probe,
        },
      },
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

it("reads only the current user's cached downloader health", async () => {
  const deps = {
    downloadersRepo: {
      get: async (userId: string) => (userId === 'user-1' ? { ...downloader, healthStatus: 'unknown' } : null),
    },
  } as never as Deps
  await expect(getDownloaderHealth(deps, 'user-1', 'dl-1')).resolves.toEqual({
    status: 'unknown',
    message: null,
    checkedAt: null,
  })
  await expect(getDownloaderHealth(deps, 'user-2', 'dl-1')).resolves.toBeNull()
})
