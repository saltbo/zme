import type { DownloadTaskPage, DownloadTaskStatus, DownloadTaskSummary } from '@shared/types'
import { type InfiniteData, type QueryClient, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { downloadTaskEventsUrl, listDownloadTasks } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

type StatusFilter = 'all' | DownloadTaskStatus
const pageSize = 20

export function useDownloadTasks(status: StatusFilter) {
  const queryClient = useQueryClient()

  useEffect(() => {
    const events = new EventSource(downloadTaskEventsUrl(), { withCredentials: true })
    events.addEventListener('snapshot', (event) => {
      const payload = parseDownloadTaskSnapshot(event)
      if (!payload) return
      updateDownloadTaskSnapshot(queryClient, status, payload.items)
    })
    return () => events.close()
  }, [queryClient, status])

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

function updateDownloadTaskSnapshot(queryClient: QueryClient, status: StatusFilter, items: DownloadTaskSummary[]) {
  const incomingById = new Map(items.map((item) => [getTaskId(item), item]))

  queryClient.setQueryData<InfiniteData<DownloadTaskPage, number>>(queryKeys.downloadTasks(status), (current) => {
    if (!current) return current

    let changed = false
    let removed = 0
    const pages = current.pages.map((page) => {
      let pageChanged = false
      const nextItems = page.items.flatMap((item) => {
        const incoming = incomingById.get(getTaskId(item))
        if (!incoming) return [item]
        changed = true
        pageChanged = true
        if (status !== 'all' && incoming.status !== status) {
          removed += 1
          return []
        }
        return [incoming]
      })
      return pageChanged ? { ...page, items: nextItems } : page
    })

    if (!changed) return current
    return {
      pages: removed > 0 ? pages.map((page) => ({ ...page, total: Math.max(0, page.total - removed) })) : pages,
      pageParams: current.pageParams,
    }
  })
}

function getTaskId(task: DownloadTaskSummary) {
  return `${task.downloaderId}:${task.id}`
}
