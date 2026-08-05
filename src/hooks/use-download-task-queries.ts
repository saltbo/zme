import type { DownloadTaskStatus } from '@shared/types'
import { useInfiniteQuery } from '@tanstack/react-query'
import { listDownloadTasks } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

type StatusFilter = 'all' | DownloadTaskStatus
const pageSize = 20
const activeStatuses = new Set<DownloadTaskStatus>([
  'queued',
  'resolving',
  'waitingSource',
  'submitting',
  'submitted',
  'running',
  'pausing',
  'paused',
  'resuming',
  'canceling',
])

export function useDownloadTasks(status: StatusFilter) {
  return useInfiniteQuery({
    queryKey: queryKeys.downloadTasks(status),
    queryFn: async ({ pageParam }) =>
      listDownloadTasks({ status: status === 'all' ? undefined : status, page: pageParam, pageSize }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0)
      return loaded < lastPage.total ? lastPage.page + 1 : undefined
    },
    refetchInterval: (query) => {
      const pages = query.state.data?.pages
      return pages?.some((page) => page.items.some((item) => activeStatuses.has(item.status))) ? 5_000 : false
    },
    refetchOnWindowFocus: true,
  })
}
