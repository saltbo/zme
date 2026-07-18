import type { DownloadTaskPage, DownloadTaskStatus, DownloadTaskSummary } from '@shared/types'
import { type InfiniteData, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DownloadsPage } from '@/routes/downloads'
import '@/i18n'
import { queryKeys } from '@/lib/query-keys'
import { useDownloadTasks } from './use-download-task-queries'

let testQueryClient: QueryClient

class SnapshotEventSource {
  static instances: SnapshotEventSource[] = []

  readonly url: string
  readonly withCredentials: boolean
  closed = false
  private readonly listeners = new Map<string, Set<EventListener>>()

  constructor(url: string | URL, init?: EventSourceInit) {
    this.url = String(url)
    this.withCredentials = init?.withCredentials ?? false
    SnapshotEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (!listener) return
    const callback: EventListener = typeof listener === 'function' ? listener : (event) => listener.handleEvent(event)
    const listeners = this.listeners.get(type) ?? new Set<EventListener>()
    listeners.add(callback)
    this.listeners.set(type, listeners)
  }

  close() {
    this.closed = true
  }

  emitSnapshot(items: DownloadTaskSummary[]) {
    const event = new MessageEvent('snapshot', { data: JSON.stringify({ items }) })
    for (const listener of this.listeners.get('snapshot') ?? []) listener(event)
  }
}

class InertIntersectionObserver {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  })
  SnapshotEventSource.instances = []
  vi.stubGlobal('EventSource', SnapshotEventSource)
  vi.stubGlobal('IntersectionObserver', InertIntersectionObserver)
})

afterEach(() => {
  testQueryClient.clear()
  vi.unstubAllGlobals()
})

describe('useDownloadTasks live snapshots', () => {
  it('renders changed speed, downloaded bytes, and card progress from successive snapshots [spec: downloads/live-task-monitoring]', async () => {
    const running = taskSummary('task-a', 'zpan-a', {
      downloadedBytes: 100,
      totalBytes: 1_000,
      downloadBps: 128,
    })
    seedDownloadTasks('all', [downloadTaskPage([running], 1, 1, 20)], [1])

    const { container } = render(<DownloadsPage />, { wrapper })

    expect(screen.getByText('128 B/s · 10%')).toBeInTheDocument()
    expect(container.querySelector('.bg-sky-300')).toHaveStyle({ width: '10%' })

    act(() => {
      eventSource().emitSnapshot([
        taskSummary('task-a', 'zpan-a', {
          downloadedBytes: 250,
          totalBytes: 1_000,
          downloadBps: 512,
        }),
      ])
    })

    await waitFor(() => expect(screen.getByText('512 B/s · 25%')).toBeInTheDocument())
    expect(container.querySelector('.bg-sky-300')).toHaveStyle({ width: '25%' })

    act(() => {
      eventSource().emitSnapshot([
        taskSummary('task-a', 'zpan-a', {
          downloadedBytes: 750,
          totalBytes: 1_000,
          downloadBps: 2_048,
        }),
      ])
    })

    await waitFor(() => expect(screen.getByText('2.0 KB/s · 75%')).toBeInTheDocument())
    expect(container.querySelector('.bg-sky-300')).toHaveStyle({ width: '75%' })
  })

  it('updates the all cache without dropping loaded pages, page params, or another downloader [spec: downloads/monitor-context]', async () => {
    const taskA = taskSummary('task-a', 'zpan-a')
    const taskB = taskSummary('task-b', 'zpan-b', { downloadBps: 64 })
    const completed = taskSummary('task-c', 'zpan-a', { status: 'completed' })
    seedDownloadTasks(
      'all',
      [downloadTaskPage([taskA, taskB], 3, 1, 2), downloadTaskPage([completed], 3, 2, 2)],
      [1, 2],
    )

    renderHook(() => useDownloadTasks('all'), { wrapper })
    act(() => {
      eventSource().emitSnapshot([
        taskSummary('task-a', 'zpan-a', {
          downloadedBytes: 400,
          downloadBps: 1_024,
        }),
      ])
    })

    await waitFor(() => expect(cachedTasks('all').find((task) => task.id === 'task-a')?.downloadBps).toBe(1_024))
    const cached = cachedDownloadTasks('all')
    expect(cached?.pageParams).toEqual([1, 2])
    expect(cached?.pages.map((page) => page.page)).toEqual([1, 2])
    expect(cached?.pages[0].items).toContainEqual(taskB)
    expect(cached?.pages[1].items).toContainEqual(completed)
    expect(cachedTasks('all').find((task) => task.id === 'task-a')).toMatchObject({
      downloadedBytes: 400,
      downloadBps: 1_024,
    })
  })

  it('updates only applicable items in the running cache while preserving its loaded context [spec: downloads/monitor-context]', async () => {
    const taskA = taskSummary('task-a', 'zpan-a')
    const taskB = taskSummary('task-b', 'zpan-b', { downloadBps: 64 })
    const taskC = taskSummary('task-c', 'zpan-a')
    seedDownloadTasks(
      'running',
      [downloadTaskPage([taskA, taskC], 3, 1, 2), downloadTaskPage([taskB], 3, 2, 2)],
      [1, 2],
    )

    renderHook(() => useDownloadTasks('running'), { wrapper })
    act(() => {
      eventSource().emitSnapshot([
        taskSummary('task-a', 'zpan-a', {
          downloadedBytes: 600,
          downloadBps: 4_096,
        }),
        taskSummary('task-c', 'zpan-a', { status: 'completed' }),
      ])
    })

    await waitFor(() => expect(cachedTasks('running').find((task) => task.id === 'task-a')?.downloadedBytes).toBe(600))
    const cached = cachedDownloadTasks('running')
    expect(cached?.pageParams).toEqual([1, 2])
    expect(cached?.pages.map((page) => page.page)).toEqual([1, 2])
    expect(cachedTasks('running').map((task) => task.id)).toEqual(['task-a', 'task-b'])
    expect(cachedTasks('running').find((task) => task.id === 'task-a')?.downloadBps).toBe(4_096)
  })
})

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
}

function eventSource() {
  const source = SnapshotEventSource.instances.at(-1)
  if (!source) throw new Error('Expected the download task hook to open an EventSource')
  return source
}

function downloadTaskPage(
  items: DownloadTaskSummary[],
  total: number,
  page: number,
  pageSize: number,
): DownloadTaskPage {
  return { items, total, page, pageSize }
}

function seedDownloadTasks(status: 'all' | DownloadTaskStatus, pages: DownloadTaskPage[], pageParams: number[]) {
  testQueryClient.setQueryData<InfiniteData<DownloadTaskPage, number>>(queryKeys.downloadTasks(status), {
    pages,
    pageParams,
  })
}

function cachedDownloadTasks(status: 'all' | DownloadTaskStatus) {
  return testQueryClient.getQueryData<InfiniteData<DownloadTaskPage, number>>(queryKeys.downloadTasks(status))
}

function cachedTasks(status: 'all' | DownloadTaskStatus) {
  return cachedDownloadTasks(status)?.pages.flatMap((page) => page.items) ?? []
}

function taskSummary(
  id: string,
  downloaderId: string,
  overrides: Partial<DownloadTaskSummary> = {},
): DownloadTaskSummary {
  return {
    id,
    downloaderId,
    downloaderName: downloaderId,
    downloaderKind: 'zpan',
    sourceType: 'magnet',
    sourceUri: `magnet:${id}`,
    name: `${id}.torrent`,
    targetFolder: '/media',
    category: null,
    tags: [],
    status: 'running',
    downloadedBytes: 100,
    storageUploadedBytes: 0,
    totalBytes: 1_000,
    downloadBps: 128,
    storageUploadBps: 0,
    errorMessage: null,
    ...overrides,
  }
}
