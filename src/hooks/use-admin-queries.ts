import { useQuery } from '@tanstack/react-query'
import { listIndexers, listMediaSources } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export function useIndexers() {
  return useQuery({
    queryKey: queryKeys.indexers,
    queryFn: async () => (await listIndexers()).items,
  })
}

export function useMediaSources() {
  return useQuery({
    queryKey: queryKeys.mediaSources,
    queryFn: async () => (await listMediaSources()).items,
  })
}
