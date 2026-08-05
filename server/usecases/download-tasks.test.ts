import type { DownloadTaskSummary } from '@shared/types'
import { describe, expect, it } from 'vitest'
import type { Deps } from './deps'
import { listDownloadTasks, streamDownloadTaskEvents } from './download-tasks'
import {
  DownloaderGatewayRateLimitError,
  type DownloaderRecord,
  type DownloadTaskEvent,
  type DownloadTaskGateway,
} from './ports'

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
  it('keeps an empty stream alive with heartbeats when no downloader supports tasks', async () => {
    const deps = {
      downloadersRepo: { listEnabled: async () => [downloaderRecord('qb-1', 'qbittorrent', 'qB')] },
      downloadTaskGateways: {},
    } as never as Deps

    const aborter = new AbortController()
    const events: DownloadTaskEvent[] = []
    await streamDownloadTaskEvents(
      deps,
      'user-1',
      aborter.signal,
      (event) => {
        events.push(event)
        if (event.event === 'heartbeat') aborter.abort()
      },
      { heartbeatIntervalMs: 0 },
    )

    expect(events[0]).toEqual({ event: 'snapshot', data: { items: [] } })
    expect(events[1]).toMatchObject({ event: 'heartbeat', data: { at: expect.any(String) } })
  })

  it('merges snapshots across downloaders until the consumer aborts', async () => {
    const zpanA = downloaderRecord('zpan-a', 'zpan', 'A')
    const zpanB = downloaderRecord('zpan-b', 'zpan', 'B')

    const gateway: DownloadTaskGateway = {
      list: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
      stream: async (_config, owner, signal, emit) => {
        await emit({
          event: 'snapshot',
          data: { items: [taskSummary(`task-${owner.downloaderId}`, owner.downloaderId)] },
        })
        await waitForAbort(signal)
      },
    }

    const deps = {
      downloadersRepo: { listEnabled: async () => [zpanA, zpanB] },
      downloadTaskGateways: { zpan: gateway },
    } as never as Deps

    const aborter = new AbortController()
    const events: DownloadTaskEvent[] = []
    await streamDownloadTaskEvents(deps, 'user-1', aborter.signal, (event) => {
      events.push(event)
      if (event.event === 'snapshot' && event.data.items.length === 2) aborter.abort()
    })

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
          await emit({
            event: 'snapshot',
            data: { items: [taskSummary('task-a', 'zpan-a', { downloadedBytes: 100, downloadBps: 10 })] },
          })
          await Promise.resolve()
          await emit({
            event: 'snapshot',
            data: { items: [taskSummary('task-a', 'zpan-a', { downloadedBytes: 400, downloadBps: 40 })] },
          })
          await waitForAbort(_signal)
          return
        }

        await emit({
          event: 'snapshot',
          data: { items: [taskSummary('task-b', 'zpan-b', { downloadedBytes: 200, downloadBps: 20 })] },
        })
        await waitForAbort(_signal)
      },
    }

    const deps = {
      downloadersRepo: { listEnabled: async () => [zpanA, zpanB] },
      downloadTaskGateways: { zpan: gateway },
    } as never as Deps

    const aborter = new AbortController()
    const events: DownloadTaskEvent[] = []
    await streamDownloadTaskEvents(deps, 'user-1', aborter.signal, (event) => {
      events.push(event)
      if (
        event.event === 'snapshot' &&
        event.data.items.some((item) => item.id === 'task-a' && item.downloadedBytes === 400) &&
        event.data.items.some((item) => item.id === 'task-b')
      ) {
        aborter.abort()
      }
    })

    const snapshots = events.filter((event) => event.event === 'snapshot')
    expect(snapshots.at(-1)?.data.items).toEqual([
      taskSummary('task-a', 'zpan-a', { downloadedBytes: 400, downloadBps: 40 }),
      taskSummary('task-b', 'zpan-b', { downloadedBytes: 200, downloadBps: 20 }),
    ])
  })

  it('reports a stream failure once and includes the retry delay', async () => {
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

    const aborter = new AbortController()
    const events: DownloadTaskEvent[] = []
    await streamDownloadTaskEvents(
      deps,
      'user-1',
      aborter.signal,
      (event) => {
        events.push(event)
        if (event.event === 'upstream-error') aborter.abort()
      },
      { initialRetryDelayMs: 25 },
    )

    expect(events).toContainEqual({
      event: 'upstream-error',
      data: {
        downloaderId: 'zpan-a',
        downloaderName: 'Broken ZPan',
        message: 'Broken ZPan: upstream gone',
        retryingInMs: 25,
      },
    })
  })

  it('honors an upstream rate-limit retry delay', async () => {
    const zpanA = downloaderRecord('zpan-a', 'zpan', 'Limited ZPan')

    const gateway: DownloadTaskGateway = {
      list: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
      stream: async () => {
        throw new DownloaderGatewayRateLimitError('Rate limit exceeded.', 28_000)
      },
    }
    const deps = {
      downloadersRepo: { listEnabled: async () => [zpanA] },
      downloadTaskGateways: { zpan: gateway },
    } as never as Deps

    const aborter = new AbortController()
    const events: DownloadTaskEvent[] = []
    await streamDownloadTaskEvents(
      deps,
      'user-1',
      aborter.signal,
      (event) => {
        events.push(event)
        if (event.event === 'upstream-error') aborter.abort()
      },
      { initialRetryDelayMs: 1_000 },
    )

    expect(events).toContainEqual({
      event: 'upstream-error',
      data: {
        downloaderId: 'zpan-a',
        downloaderName: 'Limited ZPan',
        message: 'Limited ZPan: Rate limit exceeded.',
        retryingInMs: 28_000,
      },
    })
  })

  it('reconnects one failed downloader without interrupting another downloader stream', async () => {
    const zpanA = downloaderRecord('zpan-a', 'zpan', 'A')
    const zpanB = downloaderRecord('zpan-b', 'zpan', 'B')
    let attemptsA = 0

    const gateway: DownloadTaskGateway = {
      list: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
      stream: async (_config, owner, signal, emit) => {
        if (owner.downloaderId === 'zpan-a') {
          attemptsA += 1
          if (attemptsA === 1) throw new Error('temporary outage')
          await emit({ event: 'snapshot', data: { items: [taskSummary('task-a', 'zpan-a')] } })
          await waitForAbort(signal)
          return
        }
        await emit({ event: 'snapshot', data: { items: [taskSummary('task-b', 'zpan-b')] } })
        await waitForAbort(signal)
      },
    }

    const deps = {
      downloadersRepo: { listEnabled: async () => [zpanA, zpanB] },
      downloadTaskGateways: { zpan: gateway },
    } as never as Deps

    const aborter = new AbortController()
    const events: DownloadTaskEvent[] = []
    await streamDownloadTaskEvents(
      deps,
      'user-1',
      aborter.signal,
      (event) => {
        events.push(event)
        if (event.event === 'snapshot' && event.data.items.length === 2) aborter.abort()
      },
      { initialRetryDelayMs: 0, maxRetryDelayMs: 0 },
    )

    expect(attemptsA).toBe(2)
    expect(events.filter((event) => event.event === 'upstream-error')).toHaveLength(1)
    expect(events.filter((event) => event.event === 'snapshot').at(-1)?.data.items).toHaveLength(2)
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

    expect(events.filter((event) => event.event === 'upstream-error')).toEqual([])
  })
})

function waitForAbort(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}
