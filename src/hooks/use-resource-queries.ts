import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getBookDetails, getMusicAlbumDetails, searchBooks, searchMusicAlbums } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export function useBookSearch(query: string) {
  return useQuery({
    queryKey: queryKeys.books.search(query),
    queryFn: async () => (await searchBooks(query)).results,
    enabled: query.length > 0,
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
    queryKey: queryKeys.music.search(query),
    queryFn: async () => (await searchMusicAlbums({ query })).results,
    enabled: query.length > 0,
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
