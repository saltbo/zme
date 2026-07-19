import type { DownloadTaskPage, DownloadTaskStatus, DownloadTaskSummary } from '@shared/types'
import { type InfiniteData, type QueryClient, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { toast } from 'sonner'
import i18n from '@/i18n'
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
      updateDownloadTaskSnapshots(queryClient, payload.items)
      void queryClient.invalidateQueries({ queryKey: queryKeys.downloadTasksRoot, refetchType: 'active' })
    })
    events.addEventListener('upstream-error', (event) => {
      const payload = parseUpstreamError(event)
      if (payload) toast.error(payload.message, { id: `download-task-upstream-${payload.downloaderId}` })
    })
    events.addEventListener('stream-error', (event) => {
      const message = parseStreamError(event)
      if (message) toast.error(message, { id: 'download-task-stream-source' })
    })
    events.addEventListener('open', () => toast.dismiss('download-task-stream'))
    events.addEventListener('error', () => {
      toast.error(i18n.t('downloadStreamDisconnected'), { id: 'download-task-stream' })
    })
    return () => events.close()
  }, [queryClient])

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

function parseUpstreamError(event: Event): { downloaderId: string; message: string } | null {
  if (!('data' in event) || typeof event.data !== 'string') return null
  try {
    const payload = JSON.parse(event.data) as { downloaderId?: unknown; message?: unknown }
    return typeof payload.downloaderId === 'string' && typeof payload.message === 'string'
      ? { downloaderId: payload.downloaderId, message: payload.message }
      : null
  } catch {
    return null
  }
}

function parseStreamError(event: Event): string | null {
  if (!('data' in event) || typeof event.data !== 'string') return null
  try {
    const payload = JSON.parse(event.data) as { message?: unknown }
    return typeof payload.message === 'string' ? payload.message : null
  } catch {
    return null
  }
}

function updateDownloadTaskSnapshots(queryClient: QueryClient, items: DownloadTaskSummary[]) {
  const queries = queryClient.getQueryCache().findAll({ queryKey: queryKeys.downloadTasksRoot })
  for (const query of queries) {
    const status = query.queryKey[1]
    if (typeof status !== 'string') continue
    updateDownloadTaskSnapshot(queryClient, status as StatusFilter, items)
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
