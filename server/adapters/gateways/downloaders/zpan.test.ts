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

  it('appends a music subdirectory to the typed target folder', async () => {
    const calls = stubFetch(() => jsonResponse({ id: 'task-1' }))

    await zpanDownloaderGateway.submit(config, {
      downloaderId: 'dl-1',
      uri: 'https://zme.test/api/music/tracks/track-1/content?key=temporary',
      sourceType: 'http',
      title: 'Artist - Track.mp3',
      category: 'zme:music',
      targetSubdirectory: 'Artist/Album',
    })

    expect(JSON.parse(calls[0].body ?? '')).toMatchObject({
      targetFolder: '/media/Music/Artist/Album',
      name: 'Artist - Track.mp3',
    })
  })

  it('rejects a create response without a task id', async () => {
    stubFetch(() => jsonResponse({}))

    await expect(
      zpanDownloaderGateway.submit(config, {
        downloaderId: 'dl-1',
        uri: 'magnet:?xt=urn:btih:abc',
        sourceType: 'magnet',
      }),
    ).rejects.toThrow('ZPan create download task returned an invalid response')
  })

  it('probes by listing a single download task with credentials', async () => {
    const calls = stubFetch(() => jsonResponse({ items: [], nextPageToken: null }))

    await zpanDownloaderGateway.probe(config)

    expect(calls[0].url.pathname).toBe('/api/downloads/tasks')
    expect(calls[0].url.searchParams.get('pageSize')).toBe('1')
    expect(calls[0].headers.get('authorization')).toBe('Bearer zpan-key')
  })

  it('rejects a successful response that does not match the current task-list contract', async () => {
    stubFetch(() => jsonResponse({ items: [], total: 0, page: 1, pageSize: 1 }))

    await expect(zpanDownloaderGateway.probe(config)).rejects.toThrow(
      'ZPan list download tasks returned an invalid response',
    )
  })

  it('rejects malformed task items at the HTTP boundary', async () => {
    stubFetch(() => jsonResponse({ items: [{ id: 'task-1' }], nextPageToken: null }))

    await expect(zpanDownloaderGateway.probe(config)).rejects.toThrow(
      'ZPan list download tasks returned an invalid response',
    )
  })

  it('rejects unknown upstream task states at the HTTP boundary', async () => {
    const task = zpanTask(0, 0) as unknown as { status: { state: string } }
    task.status.state = 'bogus'
    stubFetch(() => jsonResponse({ items: [task], nextPageToken: null }))

    await expect(zpanDownloaderGateway.probe(config)).rejects.toThrow(
      'ZPan list download tasks returned an invalid response',
    )
  })
})

describe('zpanDownloadTaskGateway', () => {
  it('gets a task by exact id without scanning list pages', async () => {
    const calls = stubFetch(() => jsonResponse(zpanTask(25, 5)))

    await expect(zpanDownloadTaskGateway.get?.(config, owner, 'task-1')).resolves.toMatchObject({
      id: 'task-1',
      downloadedBytes: 25,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url.pathname).toBe('/api/downloads/tasks/task-1')
  })

  it('accepts an exact task whose transfer totals are not known yet', async () => {
    const task = zpanTask(25, 5) as unknown as {
      status: {
        progress: {
          download: { totalBytes: number | null }
          upload: { totalBytes: number | null }
        }
      }
    }
    task.status.progress.download.totalBytes = null
    task.status.progress.upload.totalBytes = null
    stubFetch(() => jsonResponse(task))

    await expect(zpanDownloadTaskGateway.get?.(config, owner, 'task-1')).resolves.toMatchObject({
      id: 'task-1',
      totalBytes: null,
    })
  })

  it('rejects a malformed exact-task response', async () => {
    stubFetch(() => jsonResponse({ id: 'task-1' }))

    await expect(zpanDownloadTaskGateway.get?.(config, owner, 'task-1')).rejects.toThrow(
      'ZPan get download task returned an invalid response',
    )
  })

  it('rejects a list-item shape from the exact-task endpoint', async () => {
    const task = zpanTask(0, 0)
    const { error: _error, output: _output, updatedAt: _updatedAt, ...listStatus } = task.status
    stubFetch(() => jsonResponse({ ...task, status: listStatus }))

    await expect(zpanDownloadTaskGateway.get?.(config, owner, 'task-1')).rejects.toThrow(
      'ZPan get download task returned an invalid response',
    )
  })

  it.each([
    ['error message', { error: { message: 42 } }],
    ['output object id', { output: { objectId: 42 } }],
    ['updated revision', { updatedAt: 42 }],
  ])('rejects a malformed exact-task %s', async (_field, statusPatch) => {
    const task = zpanTask(0, 0)
    stubFetch(() => jsonResponse({ ...task, status: { ...task.status, ...statusPatch } }))

    await expect(zpanDownloadTaskGateway.get?.(config, owner, 'task-1')).rejects.toThrow(
      'ZPan get download task returned an invalid response',
    )
  })

  it('maps an exact task 404 to absence and propagates protocol failures', async () => {
    stubFetch(() => jsonResponse({ error: { message: 'not found' } }, { status: 404 }))
    await expect(zpanDownloadTaskGateway.get?.(config, owner, 'missing')).resolves.toBeNull()

    vi.unstubAllGlobals()
    stubFetch(() => jsonResponse({ error: { message: 'upstream broke' } }, { status: 502 }))
    await expect(zpanDownloadTaskGateway.get?.(config, owner, 'task-1')).rejects.toThrow(
      'ZPan get download task failed: upstream broke',
    )
  })

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
        nextPageToken: null,
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
    const upstreamSnapshots = [zpanTask(50, 5), zpanTask(100, 10), zpanTask(400, 40)]
    vi.spyOn(ZpanClient.prototype, 'listDownloadTasks').mockImplementation(async () => ({
      items: [upstreamSnapshots.shift() ?? zpanTask(400, 40)],
      nextPageToken: null,
    }))
    vi.spyOn(ZpanClient.prototype, 'streamDownloadTaskEvents').mockImplementation(async (_signal, emit) => {
      await emit({ event: 'resource-change', data: { resourceType: 'download-task' } })
      await emit({ event: 'resource-change', data: { resourceType: 'download-task' } })
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
      items: params.pageToken ? [lastTask] : firstPage,
      nextPageToken: params.pageToken ? null : 'next-page',
    }))
    vi.spyOn(ZpanClient.prototype, 'streamDownloadTaskEvents').mockImplementation(async (_signal, emit) => {
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
    expect(list.mock.calls.map(([params]) => params.pageToken)).toEqual([
      undefined,
      'next-page',
      undefined,
      'next-page',
    ])
  })

  it('rejects a repeated upstream page token', async () => {
    vi.spyOn(ZpanClient.prototype, 'listDownloadTasks').mockResolvedValue({
      items: [],
      nextPageToken: 'repeated',
    })

    await expect(zpanDownloadTaskGateway.list(config, owner, { page: 1, pageSize: 20 })).rejects.toThrow(
      'ZPan repeated a download task page token',
    )
  })

  it('fails a unique-token scan at the explicit page limit', async () => {
    let page = 0
    const list = vi.spyOn(ZpanClient.prototype, 'listDownloadTasks').mockImplementation(async () => ({
      items: [],
      nextPageToken: `page-${++page}`,
    }))

    await expect(zpanDownloadTaskGateway.list(config, owner, { page: 1, pageSize: 20 })).rejects.toThrow(
      'ZPan download task scan exceeded 100 pages',
    )
    expect(list).toHaveBeenCalledTimes(100)
  })

  it('cancels a scan before issuing another upstream request', async () => {
    const aborter = new AbortController()
    aborter.abort()
    const list = vi.spyOn(ZpanClient.prototype, 'listDownloadTasks')

    await expect(
      zpanDownloadTaskGateway.list(config, owner, { page: 1, pageSize: 20 }, aborter.signal),
    ).rejects.toThrow('ZPan download task scan canceled')
    expect(list).not.toHaveBeenCalled()
  })

  it('fails a stalled scan at the overall deadline', async () => {
    vi.useFakeTimers()
    vi.spyOn(ZpanClient.prototype, 'listDownloadTasks').mockImplementation(
      async (_params, signal) =>
        await new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )

    const result = zpanDownloadTaskGateway.list(config, owner, { page: 1, pageSize: 20 })
    const expectation = expect(result).rejects.toThrow('ZPan download task scan timed out')
    await vi.advanceTimersByTimeAsync(10_000)
    await expectation
    vi.useRealTimers()
  })

  it('rejects malformed error events with a stable gateway error', async () => {
    vi.spyOn(ZpanClient.prototype, 'listDownloadTasks').mockResolvedValue({ items: [], nextPageToken: null })
    vi.spyOn(ZpanClient.prototype, 'streamDownloadTaskEvents').mockImplementation(async (_signal, emit) => {
      await emit({ event: 'error', data: null })
    })

    await expect(zpanDownloadTaskGateway.stream(config, owner, new AbortController().signal, () => {})).rejects.toThrow(
      'ZPan error event returned an invalid payload',
    )
  })

  it('rejects malformed SSE control payloads at the protocol boundary', async () => {
    stubFetch(
      () =>
        new Response('event: error\ndata: null\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        }),
    )

    await expect(
      new ZpanClient(config.endpoint, config.credentials.apiKey).streamDownloadTaskEvents(
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow('ZPan download task events failed: ZPan error event returned an invalid payload')
  })

  it('validates and forwards current SSE control events', async () => {
    stubFetch(
      () =>
        new Response(
          [
            'event: resource-change\ndata: {"resourceType":"download-task"}',
            'event: resync\ndata: {"sequence":12}',
            'event: heartbeat\ndata: {"at":"2026-08-05T00:00:00.000Z"}',
            'event: error\ndata: {"message":"temporary"}',
            'event: future-event\ndata: {"value":1}',
            '',
          ].join('\n\n'),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    )
    const events: string[] = []

    await new ZpanClient(config.endpoint, config.credentials.apiKey).streamDownloadTaskEvents(
      new AbortController().signal,
      (event) => {
        events.push(event.event)
      },
    )

    expect(events).toEqual(['resource-change', 'resync', 'heartbeat', 'error', 'future-event'])
  })

  it('rejects malformed resource-change events at the protocol boundary', async () => {
    stubFetch(
      () =>
        new Response('event: resource-change\ndata: {}\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        }),
    )

    await expect(
      new ZpanClient(config.endpoint, config.credentials.apiKey).streamDownloadTaskEvents(
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow('ZPan download task events failed: ZPan resource-change event returned an invalid payload')
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
      resolveStartedAt: '',
      resolveCompletedAt: '',
      downloadCompletedAt: '',
      ingestStartedAt: '',
      ingestCompletedAt: '',
      seedingStartedAt: '',
      seedingStoppedAt: '',
      startedAt: '2026-07-18T00:00:00.000Z',
      finishedAt: '',
      updatedAt: '2026-07-18T00:00:01.000Z',
    },
  }
}
