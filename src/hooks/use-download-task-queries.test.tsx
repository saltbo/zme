import type { DownloadTaskPage, DownloadTaskSummary } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listDownloadTasks } from '@/lib/api'
import { useDownloadTasks } from './use-download-task-queries'

vi.mock('@/lib/api', () => ({ listDownloadTasks: vi.fn() }))

let client: QueryClient

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(() => {
  client.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useDownloadTasks polling', () => {
  it('polls while a download is active and stops after it reaches a terminal state', async () => {
    vi.mocked(listDownloadTasks)
      .mockResolvedValueOnce(page([task('running')]))
      .mockResolvedValueOnce(page([task('completed')]))

    const { result } = renderHook(() => useDownloadTasks('all'), { wrapper })
    await waitFor(() => expect(result.current.data?.pages[0].items[0].status).toBe('running'))

    await act(async () => vi.advanceTimersByTimeAsync(5_000))
    await waitFor(() => expect(result.current.data?.pages[0].items[0].status).toBe('completed'))
    expect(listDownloadTasks).toHaveBeenCalledTimes(2)

    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    expect(listDownloadTasks).toHaveBeenCalledTimes(2)
  })

  it('does not poll a terminal-only page', async () => {
    vi.mocked(listDownloadTasks).mockResolvedValue(page([task('failed')]))

    const { result } = renderHook(() => useDownloadTasks('all'), { wrapper })
    await waitFor(() => expect(result.current.data?.pages[0].items[0].status).toBe('failed'))
    await act(async () => vi.advanceTimersByTimeAsync(10_000))

    expect(listDownloadTasks).toHaveBeenCalledTimes(1)
  })
})

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function page(items: DownloadTaskSummary[]): DownloadTaskPage {
  return { items, total: items.length, page: 1, pageSize: 20 }
}

function task(status: DownloadTaskSummary['status']): DownloadTaskSummary {
  return {
    id: 'download-1',
    downloaderId: 'zpan-1',
    downloaderName: 'ZPan',
    downloaderKind: 'zpan',
    sourceType: 'magnet',
    sourceUri: 'magnet:?xt=urn:btih:test',
    name: 'Example',
    targetFolder: '/media',
    category: 'zme:movie',
    tags: [],
    status,
    downloadedBytes: 0,
    storageUploadedBytes: 0,
    totalBytes: 100,
    downloadBps: 0,
    storageUploadBps: 0,
    errorMessage: null,
  }
}
