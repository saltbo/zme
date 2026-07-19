import { ZpanClient, type ZpanDownloadTask } from '@server/adapters/gateways/zpan-client'
import type { ConnectorConfig, DownloaderGateway, DownloadTaskOwner } from '@server/usecases/ports'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, stubFetch } from './test-support'
import { zpanDownloaderGateway, zpanDownloadTaskGateway } from './zpan'

const config: ConnectorConfig = {
  endpoint: 'http://zpan.local',
  credentials: { apiKey: 'zpan-key' },
  options: { targetFolder: '/media' },
}

const owner: DownloadTaskOwner = {
  downloaderId: 'dl-1',
  downloaderName: 'My ZPan',
  downloaderKind: 'zpan',
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('zpanDownloaderGateway', () => {
  it('creates a download task with normalized category and typed target folder', async () => {
    const calls = stubFetch(() => jsonResponse({ id: 'task-1' }))

    const input: Parameters<DownloaderGateway['submit']>[1] = {
      downloaderId: 'dl-1',
      uri: 'magnet:?xt=urn:btih:abc',
      sourceType: 'magnet',
      title: 'Some Movie',
      category: 'movie',
      tags: ['hd'],
    }
    await zpanDownloaderGateway.submit(config, input)

    expect(calls).toHaveLength(1)
    expect(`${calls[0].method} ${calls[0].url.href}`).toBe('POST http://zpan.local/api/downloads/tasks')
    expect(calls[0].headers.get('authorization')).toBe('Bearer zpan-key')
    expect(JSON.parse(calls[0].body ?? '')).toEqual({
      source: { type: 'magnet', uri: 'magnet:?xt=urn:btih:abc' },
      targetFolder: '/media/Movies',
      name: 'Some Movie',
      category: 'zme:movie',
      tags: ['hd'],
    })
  })

  it('probes by listing a single download task with credentials', async () => {
    const calls = stubFetch(() => jsonResponse({ items: [], total: 0, page: 1, pageSize: 1 }))

    await zpanDownloaderGateway.probe(config)

    expect(calls[0].url.pathname).toBe('/api/downloads/tasks')
    expect(calls[0].url.searchParams.get('pageSize')).toBe('1')
    expect(calls[0].headers.get('authorization')).toBe('Bearer zpan-key')
  })
})

describe('zpanDownloadTaskGateway', () => {
  it('maps zme statuses to zpan statuses in the query and back in the result', async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        items: [
          {
            id: 'task-1',
            spec: {
              source: { type: 'magnet', uri: 'magnet:?xt=urn:btih:abc' },
              destination: { name: '', folder: '/media/Movies' },
              labels: { category: 'zme:movie', tags: [] },
            },
            status: {
              state: 'downloading',
              progress: {
                download: { bytes: 10, totalBytes: 100, bytesPerSecond: 5 },
                upload: { bytes: 1, bytesPerSecond: 2 },
              },
              runtime: { torrent: { name: 'Runtime Name' } },
            },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
    )

    const page = await zpanDownloadTaskGateway.list(config, owner, { status: 'running', page: 1, pageSize: 20 })

    expect(calls[0].url.pathname).toBe('/api/downloads/tasks')
    expect(calls[0].url.searchParams.get('status')).toBe('downloading')

    expect(page.total).toBe(1)
    expect(page.items[0]).toMatchObject({
      id: 'task-1',
      downloaderId: 'dl-1',
      downloaderName: 'My ZPan',
      downloaderKind: 'zpan',
      name: 'Runtime Name',
      status: 'running',
      downloadedBytes: 10,
      totalBytes: 100,
    })
  })

  it('maps successive ZPan snapshots to changed live speed and progress [spec: downloads/live-task-monitoring]', async () => {
    vi.spyOn(ZpanClient.prototype, 'listDownloadTasks').mockResolvedValue({
      items: [zpanTask(50, 5)],
      total: 1,
      page: 1,
      pageSize: 50,
    })
    vi.spyOn(ZpanClient.prototype, 'streamDownloadTaskEvents').mockImplementation(async (_params, _signal, emit) => {
      await emit({
        event: 'download-tasks',
        data: { items: [zpanTask(100, 10)], total: 1, page: 1, pageSize: 20 },
      })
      await emit({
        event: 'download-tasks',
        data: { items: [zpanTask(400, 40)], total: 1, page: 1, pageSize: 20 },
      })
    })

    const snapshots: Array<{ downloadedBytes: number; downloadBps: number }> = []
    await zpanDownloadTaskGateway.stream(config, owner, new AbortController().signal, (event) => {
      if (event.event !== 'snapshot') return
      snapshots.push({
        downloadedBytes: event.data.items[0].downloadedBytes,
        downloadBps: event.data.items[0].downloadBps,
      })
    })

    expect(snapshots).toEqual([
      { downloadedBytes: 50, downloadBps: 5 },
      { downloadedBytes: 100, downloadBps: 10 },
      { downloadedBytes: 400, downloadBps: 40 },
    ])
  })

  it('refreshes a complete paginated snapshot when ZPan sends a heartbeat', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => zpanTask(index, index))
    const lastTask = { ...zpanTask(50, 50), id: 'task-51' }
    const list = vi.spyOn(ZpanClient.prototype, 'listDownloadTasks').mockImplementation(async (params) => ({
      items: params.page === 1 ? firstPage : [lastTask],
      total: 51,
      page: params.page ?? 1,
      pageSize: 50,
    }))
    vi.spyOn(ZpanClient.prototype, 'streamDownloadTaskEvents').mockImplementation(async (_params, _signal, emit) => {
      await emit({ event: 'heartbeat', data: { at: '2026-07-19T00:00:00.000Z' } })
    })

    const snapshots: string[][] = []
    await zpanDownloadTaskGateway.stream(config, owner, new AbortController().signal, (event) => {
      if (event.event === 'snapshot') snapshots.push(event.data.items.map((item) => item.id))
    })

    expect(snapshots).toHaveLength(2)
    expect(snapshots[0]).toHaveLength(51)
    expect(snapshots[1]).toHaveLength(51)
    expect(snapshots[1]).toContain('task-51')
    expect(list.mock.calls.map(([params]) => params.page)).toEqual([1, 2, 1, 2])
  })
})

function zpanTask(downloadedBytes: number, downloadBps: number): ZpanDownloadTask {
  return {
    id: 'task-1',
    createdAt: '2026-07-18T00:00:00.000Z',
    spec: {
      source: { type: 'magnet', uri: 'magnet:?xt=urn:btih:abc' },
      destination: { name: 'Live Task', folder: '/media/Movies' },
      labels: { category: 'zme:movie', tags: [] },
    },
    status: {
      state: 'downloading',
      attempt: 1,
      assignment: { downloaderId: 'worker-1' },
      progress: {
        download: { bytes: downloadedBytes, totalBytes: 1_000, bytesPerSecond: downloadBps },
        upload: { bytes: 0, totalBytes: 1_000, bytesPerSecond: 0 },
      },
      billing: { state: 'ok', authorizedBytes: 1_000, chargedBytes: 0, chargedCredits: 0 },
      output: { objectId: '' },
      runtime: {},
      error: { message: '' },
      startedAt: '2026-07-18T00:00:00.000Z',
      finishedAt: '',
      updatedAt: '2026-07-18T00:00:01.000Z',
    },
  }
}
