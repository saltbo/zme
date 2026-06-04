import type { MediaKind } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { getMediaDetails, getPopularMedia, getTrendingMedia, searchMedia } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export function useTrendingMedia(language: string) {
  return useQuery({
    queryKey: queryKeys.media.trending(language),
    queryFn: async () => (await getTrendingMedia(language)).results,
  })
}

export function usePopularMedia(kind: MediaKind, language: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.media.popular(kind, language),
    queryFn: async () => (await getPopularMedia(kind, language)).results,
    enabled: options?.enabled,
  })
}

export function useMediaSearch(query: string, language: string) {
  return useQuery({
    queryKey: queryKeys.media.search(query, language),
    queryFn: async () => (await searchMedia(query, language)).results,
    enabled: query.length > 0,
  })
}

export function useMediaDetails(kind: MediaKind, id: number, language: string) {
  return useQuery({
    queryKey: queryKeys.media.details(kind, id, language),
    queryFn: async () => (await getMediaDetails(kind, id, language)).item,
    enabled: Number.isInteger(id) && id > 0,
  })
}
