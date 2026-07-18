import type { DownloadTaskSummary } from '@shared/types'
import { describe, expect, it } from 'vitest'
import type { Deps } from './deps'
import { listDownloadTasks, streamDownloadTaskEvents } from './download-tasks'
import type { DownloaderRecord, DownloadTaskEvent, DownloadTaskGateway } from './ports'

function downloaderRecord(id: string, kind: DownloaderRecord['kind'], description: string): DownloaderRecord {
  return {
    id,
    description,
    kind,
    config: { endpoint: `http://${id}.local`, credentials: {}, options: {} },
    enabled: true,
    healthStatus: 'online',
    healthMessage: null,
    healthCheckedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }
}

function taskSummary(id: string, downloaderId: string, overrides: Partial<DownloadTaskSummary> = {}) {
  return {
    id,
    downloaderId,
    downloaderName: 'ZPan',
    downloaderKind: 'zpan',
    sourceType: 'magnet',
    sourceUri: 'magnet:x',
    name: id,
    targetFolder: '/media',
    category: null,
    tags: [],
    status: 'running',
    downloadedBytes: 0,
    storageUploadedBytes: 0,
    totalBytes: null,
    downloadBps: 0,
    storageUploadBps: 0,
    errorMessage: null,
    ...overrides,
  } as never
}

describe('listDownloadTasks', () => {
  it('aggregates pages from task-capable downloaders only', async () => {
    const zpanA = downloaderRecord('zpan-a', 'zpan', 'A')
    const zpanB = downloaderRecord('zpan-b', 'zpan', 'B')
    const qb = downloaderRecord('qb-1', 'qbittorrent', 'qB')

    const gateway: DownloadTaskGateway = {
      list: async (_config, owner) => ({
        items: [taskSummary(`task-${owner.downloaderId}`, owner.downloaderId)],
        total: 2,
        page: 1,
        pageSize: 20,
      }),
      stream: async () => {},
    }

    const deps = {
      downloadersRepo: { listEnabled: async () => [zpanA, qb, zpanB] },
      downloadTaskGateways: { zpan: gateway },
    } as never as Deps

    const page = await listDownloadTasks(deps, 'user-1', { page: 1, pageSize: 20 })

    expect(page.items.map((item) => item.id)).toEqual(['task-zpan-a', 'task-zpan-b'])
    expect(page.total).toBe(4)
    expect(page.page).toBe(1)
  })
})

describe('streamDownloadTaskEvents', () => {
  it('emits one empty snapshot and resolves when no downloader supports tasks', async () => {
    const deps = {
      downloadersRepo: { listEnabled: async () => [downloaderRecord('qb-1', 'qbittorrent', 'qB')] },
      downloadTaskGateways: {},
    } as never as Deps

    const events: DownloadTaskEvent[] = []
    await streamDownloadTaskEvents(deps, 'user-1', new AbortController().signal, (event) => events.push(event))

    expect(events).toEqual([{ event: 'snapshot', data: { items: [] } }])
  })

  it('merges snapshots across downloaders and resolves when all streams end', async () => {
    const zpanA = downloaderRecord('zpan-a', 'zpan', 'A')
    const zpanB = downloaderRecord('zpan-b', 'zpan', 'B')

    const gateway: DownloadTaskGateway = {
      list: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
      stream: async (_config, owner, _signal, emit) => {
        emit({ event: 'snapshot', data: { items: [taskSummary(`task-${owner.downloaderId}`, owner.downloaderId)] } })
      },
    }

    const deps = {
      downloadersRepo: { listEnabled: async () => [zpanA, zpanB] },
      downloadTaskGateways: { zpan: gateway },
    } as never as Deps

    const events: DownloadTaskEvent[] = []
    await streamDownloadTaskEvents(deps, 'user-1', new AbortController().signal, (event) => events.push(event))

    const lastSnapshot = events.filter((event) => event.event === 'snapshot').at(-1)
    expect(lastSnapshot?.data.items.map((item: { id: string }) => item.id).sort()).toEqual([
      'task-zpan-a',
      'task-zpan-b',
    ])
  })

  it('keeps another downloader in the merged snapshot when one downloader reports successive live progress [spec: downloads/monitor-context]', async () => {
    const zpanA = downloaderRecord('zpan-a', 'zpan', 'A')
    const zpanB = downloaderRecord('zpan-b', 'zpan', 'B')

    const gateway: DownloadTaskGateway = {
      list: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
      stream: async (_config, owner, _signal, emit) => {
        if (owner.downloaderId === 'zpan-a') {
          emit({
            event: 'snapshot',
            data: { items: [taskSummary('task-a', 'zpan-a', { downloadedBytes: 100, downloadBps: 10 })] },
          })
          await Promise.resolve()
          emit({
            event: 'snapshot',
            data: { items: [taskSummary('task-a', 'zpan-a', { downloadedBytes: 400, downloadBps: 40 })] },
          })
          return
        }

        emit({
          event: 'snapshot',
          data: { items: [taskSummary('task-b', 'zpan-b', { downloadedBytes: 200, downloadBps: 20 })] },
        })
      },
    }

    const deps = {
      downloadersRepo: { listEnabled: async () => [zpanA, zpanB] },
      downloadTaskGateways: { zpan: gateway },
    } as never as Deps

    const events: DownloadTaskEvent[] = []
    await streamDownloadTaskEvents(deps, 'user-1', new AbortController().signal, (event) => events.push(event))

    const snapshots = events.filter((event) => event.event === 'snapshot')
    expect(snapshots.at(-1)?.data.items).toEqual([
      taskSummary('task-a', 'zpan-a', { downloadedBytes: 400, downloadBps: 40 }),
      taskSummary('task-b', 'zpan-b', { downloadedBytes: 200, downloadBps: 20 }),
    ])
  })

  it('reports stream failures as error events prefixed with the downloader name', async () => {
    const zpanA = downloaderRecord('zpan-a', 'zpan', 'Broken ZPan')

    const gateway: DownloadTaskGateway = {
      list: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
      stream: async () => {
        throw new Error('upstream gone')
      },
    }

    const deps = {
      downloadersRepo: { listEnabled: async () => [zpanA] },
      downloadTaskGateways: { zpan: gateway },
    } as never as Deps

    const events: DownloadTaskEvent[] = []
    await streamDownloadTaskEvents(deps, 'user-1', new AbortController().signal, (event) => events.push(event))

    expect(events).toContainEqual({ event: 'error', data: { message: 'Broken ZPan: upstream gone' } })
  })

  it('suppresses failure events after the consumer aborts', async () => {
    const zpanA = downloaderRecord('zpan-a', 'zpan', 'A')
    const aborter = new AbortController()

    const gateway: DownloadTaskGateway = {
      list: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
      stream: async (_config, _owner, signal) => {
        aborter.abort()
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (signal.aborted) throw new Error('aborted upstream')
      },
    }

    const deps = {
      downloadersRepo: { listEnabled: async () => [zpanA] },
      downloadTaskGateways: { zpan: gateway },
    } as never as Deps

    const events: DownloadTaskEvent[] = []
    await streamDownloadTaskEvents(deps, 'user-1', aborter.signal, (event) => events.push(event))

    expect(events.filter((event) => event.event === 'error')).toEqual([])
  })
})
