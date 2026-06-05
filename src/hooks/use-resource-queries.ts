import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  getBookDetails,
  getMusicAlbumDetails,
  getPopularMusicAlbums,
  getTrendingBooks,
  searchBooks,
  searchMusicAlbums,
} from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export function useBookSearch(query: string) {
  return useQuery({
    queryKey: query ? queryKeys.books.search(query) : queryKeys.books.trending,
    queryFn: async () => (query ? (await searchBooks(query)).results : (await getTrendingBooks()).results),
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

export function useMusicSearch(query: string) {
  return useQuery({
    queryKey: query ? queryKeys.music.search(query) : queryKeys.music.popular,
    queryFn: async () =>
      query ? (await searchMusicAlbums({ query })).results : (await getPopularMusicAlbums()).results,
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
