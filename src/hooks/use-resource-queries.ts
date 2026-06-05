import type { BookDiscoveryInput, MusicDiscoveryInput } from '@shared/types'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  discoverBooks,
  discoverMusicAlbums,
  getBookDetails,
  getMusicAlbumDetails,
  searchBooks,
  searchMusicAlbums,
} from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export function useBookSearch(query: string, discovery: Omit<BookDiscoveryInput, 'page'>) {
  return useInfiniteQuery({
    queryKey: query ? queryKeys.books.search(query) : queryKeys.books.discover(discovery),
    queryFn: async ({ pageParam }) =>
      query ? searchBooks({ query, page: pageParam }) : discoverBooks({ ...discovery, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined),
  })
}

export function useBookDetails(mediaKey: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.books.details(mediaKey),
    queryFn: async () => (await getBookDetails(mediaKey)).item,
    enabled: mediaKey.length > 0 && options?.enabled !== false,
    placeholderData: keepPreviousData,
  })
}

export function useMusicSearch(query: string, discovery: Omit<MusicDiscoveryInput, 'page'>) {
  return useInfiniteQuery({
    queryKey: query ? queryKeys.music.search(query) : queryKeys.music.discover(discovery),
    queryFn: async ({ pageParam }) =>
      query ? searchMusicAlbums({ query, page: pageParam }) : discoverMusicAlbums({ ...discovery, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined),
  })
}

export function useMusicAlbumDetails(mediaKey: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.music.details(mediaKey),
    queryFn: async () => (await getMusicAlbumDetails(mediaKey)).item,
    enabled: mediaKey.length > 0 && options?.enabled !== false,
    placeholderData: keepPreviousData,
  })
}
