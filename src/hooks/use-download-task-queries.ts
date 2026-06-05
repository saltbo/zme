import type { DownloadTaskPage, DownloadTaskStatus, DownloadTaskSummary } from '@shared/types'
import { type InfiniteData, useInfiniteQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { downloadTaskEventsUrl, listDownloadTasks } from '@/lib/api'
import { queryClient } from '@/lib/query-client'
import { queryKeys } from '@/lib/query-keys'

type StatusFilter = 'all' | DownloadTaskStatus
const pageSize = 20

export function useDownloadTasks(status: StatusFilter) {
  useEffect(() => {
    const events = new EventSource(downloadTaskEventsUrl(), { withCredentials: true })
    events.addEventListener('snapshot', (event) => {
      const payload = parseDownloadTaskSnapshot(event)
      if (!payload) return
      updateDownloadTaskSnapshot(status, payload.items)
    })
    return () => events.close()
  }, [status])

  return useInfiniteQuery({
    queryKey: queryKeys.downloadTasks(status),
    queryFn: async ({ pageParam }) =>
      listDownloadTasks({ status: status === 'all' ? undefined : status, page: pageParam, pageSize }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0)
      return loaded < lastPage.total ? lastPage.page + 1 : undefined
    },
    refetchOnWindowFocus: false,
  })
}

function parseDownloadTaskSnapshot(event: Event): { items: DownloadTaskSummary[] } | null {
  if (!('data' in event) || typeof event.data !== 'string') return null
  try {
    const payload = JSON.parse(event.data) as { items?: unknown }
    return Array.isArray(payload.items) ? { items: payload.items as DownloadTaskSummary[] } : null
  } catch {
    return null
  }
}

function updateDownloadTaskSnapshot(status: StatusFilter, items: DownloadTaskSummary[]) {
  const filteredItems = status === 'all' ? items : items.filter((item) => item.status === status)
  const page: DownloadTaskPage = {
    items: filteredItems,
    total: filteredItems.length,
    page: 1,
    pageSize: Math.max(pageSize, filteredItems.length),
  }
  const data: InfiniteData<DownloadTaskPage, number> = {
    pages: [page],
    pageParams: [1],
  }
  queryClient.setQueryData(queryKeys.downloadTasks(status), data)
}
