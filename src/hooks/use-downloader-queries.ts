import { useQuery } from '@tanstack/react-query'
import { listDownloaders } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export function useDownloaders() {
  return useQuery({
    queryKey: queryKeys.downloaders,
    queryFn: async () => (await listDownloaders()).items,
  })
}
