import type { MediaDiscoverInput, MediaKind } from '@shared/types'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  discoverMedia,
  getMediaDetails,
  getMediaWatchClickouts,
  getPersonCredits,
  getPopularMedia,
  getSeasonDetails,
  getTrendingMedia,
  listMediaGenres,
  searchMedia,
} from '@/lib/api'
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

export function useDiscoverMedia(input: Omit<MediaDiscoverInput, 'page'>, options?: { enabled?: boolean }) {
  return useInfiniteQuery({
    queryKey: queryKeys.media.discover(input),
    queryFn: async ({ pageParam }) => discoverMedia({ ...input, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined),
    enabled: options?.enabled,
  })
}

export function useMediaGenres(kind: MediaKind, language: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.media.genres(kind, language),
    queryFn: async () => (await listMediaGenres(kind, language)).genres,
    enabled: options?.enabled,
  })
}

export function useMediaSearch(query: string, language: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.media.search(query, language),
    queryFn: async () => (await searchMedia(query, language)).results,
    enabled: query.length > 0 && options?.enabled !== false,
  })
}

export function useMediaDetails(kind: MediaKind, id: number, language: string, watchRegion = 'US') {
  return useQuery({
    queryKey: queryKeys.media.details(kind, id, language, watchRegion),
    queryFn: async () => (await getMediaDetails(kind, id, language, watchRegion)).item,
    enabled: Number.isInteger(id) && id > 0,
    placeholderData: keepPreviousData,
  })
}

export function useSeasonDetails(seriesId: number, seasonNumber: number, language: string) {
  return useQuery({
    queryKey: queryKeys.media.season(seriesId, seasonNumber, language),
    queryFn: async () => (await getSeasonDetails(seriesId, seasonNumber, language)).item,
    enabled: Number.isInteger(seriesId) && seriesId > 0 && Number.isInteger(seasonNumber) && seasonNumber >= 0,
  })
}

export function useMediaWatchClickouts(
  kind: MediaKind,
  id: number,
  watchRegion = 'US',
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: queryKeys.media.watchClickouts(kind, id, watchRegion),
    queryFn: async () => (await getMediaWatchClickouts(kind, id, watchRegion)).clickouts,
    enabled: Number.isInteger(id) && id > 0 && options?.enabled !== false,
    staleTime: 1000 * 60 * 30,
  })
}

export function usePersonCredits(id: number, language: string) {
  return useQuery({
    queryKey: queryKeys.media.personCredits(id, language),
    queryFn: async () => getPersonCredits(id, language),
    enabled: Number.isInteger(id) && id > 0,
  })
}
