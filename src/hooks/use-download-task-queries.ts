import type { DownloadTaskStatus } from '@shared/types'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { downloadTaskEventsUrl, listDownloadTasks } from '@/lib/api'
import { queryClient } from '@/lib/query-client'
import { queryKeys } from '@/lib/query-keys'

type StatusFilter = 'all' | DownloadTaskStatus
const pageSize = 20

export function useDownloadTasks(status: StatusFilter) {
  useEffect(() => {
    const events = new EventSource(downloadTaskEventsUrl(), { withCredentials: true })
    events.addEventListener('snapshot', () => {
      queryClient.invalidateQueries({ queryKey: ['download-tasks'] })
    })
    events.addEventListener('error', () => {
      queryClient.invalidateQueries({ queryKey: ['download-tasks'] })
    })
    return () => events.close()
  }, [])

  return useInfiniteQuery({
    queryKey: queryKeys.downloadTasks(status),
    queryFn: async ({ pageParam }) =>
      listDownloadTasks({ status: status === 'all' ? undefined : status, page: pageParam, pageSize }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0)
      return loaded < lastPage.total ? lastPage.page + 1 : undefined
    },
  })
}
