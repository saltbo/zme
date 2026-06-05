import type { LibraryMediaItem, MediaSearchItem } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createFavorite, deleteFavorite, listLibrary, markWatched, unmarkWatched } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export type MediaStatus = 'none' | 'saved' | 'watched'

interface LibraryContextValue {
  items: LibraryMediaItem[]
  loading: boolean
  isFavorite: (item: Pick<MediaSearchItem, 'id' | 'kind'>) => boolean
  isWatched: (item: Pick<MediaSearchItem, 'id' | 'kind'>) => boolean
  getMediaStatus: (item: Pick<MediaSearchItem, 'id' | 'kind'>) => MediaStatus
  setMediaStatus: (item: MediaSearchItem, status: MediaStatus) => Promise<void>
  toggleFavorite: (item: MediaSearchItem) => Promise<void>
  toggleWatched: (item: MediaSearchItem) => Promise<void>
}

const LibraryContext = createContext<LibraryContextValue | null>(null)

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const library = useQuery({
    queryKey: queryKeys.library,
    queryFn: async () => (await listLibrary()).items,
  })
  const libraryItems = library.data ?? []
  const items = useMemo(() => libraryItems.filter((item) => item.savedAt), [libraryItems])

  const savedKeys = useMemo(() => new Set(items.map((item) => getMediaKey(item))), [items])
  const watchedKeys = useMemo(
    () => new Set(libraryItems.filter((item) => item.watchedAt).map((item) => getMediaKey(item))),
    [libraryItems],
  )
  const stateByKey = useMemo(() => new Map(libraryItems.map((item) => [getMediaKey(item), item])), [libraryItems])

  const isFavorite = useCallback(
    (item: Pick<MediaSearchItem, 'id' | 'kind'>) => savedKeys.has(getMediaKey(item)),
    [savedKeys],
  )

  const isWatched = useCallback(
    (item: Pick<MediaSearchItem, 'id' | 'kind'>) => watchedKeys.has(getMediaKey(item)),
    [watchedKeys],
  )

  const getMediaStatus = useCallback(
    (item: Pick<MediaSearchItem, 'id' | 'kind'>): MediaStatus => {
      const state = stateByKey.get(getMediaKey(item))
      if (state?.watchedAt) return 'watched'
      if (state?.savedAt) return 'saved'
      return 'none'
    },
    [stateByKey],
  )

  const saveSavedItem = useMutation({
    mutationFn: createFavorite,
    onSuccess: (payload, item) => {
      const key = getMediaKey(item)
      queryClient.setQueryData<LibraryMediaItem[]>(queryKeys.library, (current = []) => [
        payload.item,
        ...current.filter((libraryItem) => getMediaKey(libraryItem) !== key),
      ])
      toast.success(t('favoriteAdded'))
    },
  })

  const removeSavedItem = useMutation({
    mutationFn: (item: MediaSearchItem) => deleteFavorite(item.kind, item.id),
    onSuccess: (_payload, item) => {
      const key = getMediaKey(item)
      queryClient.setQueryData<LibraryMediaItem[]>(queryKeys.library, (current = []) =>
        current.flatMap((libraryItem) => {
          if (getMediaKey(libraryItem) !== key) return [libraryItem]
          return libraryItem.watchedAt ? [{ ...libraryItem, savedAt: null }] : []
        }),
      )
      toast.success(t('favoriteRemoved'))
    },
  })

  const saveWatched = useMutation({
    mutationFn: async ({ item, watched }: { item: MediaSearchItem; watched: boolean }) =>
      watched ? markWatched(item) : unmarkWatched(item.kind, item.id),
    onSuccess: (payload, variables) => {
      const key = getMediaKey(variables.item)
      queryClient.setQueryData<LibraryMediaItem[]>(queryKeys.library, (current = []) => {
        if (!payload.item) return current.filter((state) => getMediaKey(state) !== key)
        return [payload.item, ...current.filter((state) => getMediaKey(state) !== key)]
      })
      toast.success(variables.watched ? t('watchedAdded') : t('watchedRemoved'))
    },
  })

  const toggleFavorite = useCallback(
    async (item: MediaSearchItem) => {
      if (savedKeys.has(getMediaKey(item))) {
        await removeSavedItem.mutateAsync(item)
        return
      }

      await saveSavedItem.mutateAsync(item)
    },
    [removeSavedItem, savedKeys, saveSavedItem],
  )

  const toggleWatched = useCallback(
    async (item: MediaSearchItem) => {
      await saveWatched.mutateAsync({ item, watched: !watchedKeys.has(getMediaKey(item)) })
    },
    [saveWatched, watchedKeys],
  )

  const setMediaStatus = useCallback(
    async (item: MediaSearchItem, status: MediaStatus) => {
      const current = getMediaStatus(item)
      if (current === status) return

      if (status === 'saved') {
        if (current === 'watched') {
          await saveWatched.mutateAsync({ item, watched: false })
          return
        }
        await saveSavedItem.mutateAsync(item)
        return
      }

      if (status === 'watched') {
        await saveWatched.mutateAsync({ item, watched: true })
        return
      }

      if (current === 'watched') {
        await saveWatched.mutateAsync({ item, watched: false })
      }
      if (current !== 'none') {
        await removeSavedItem.mutateAsync(item)
      }
    },
    [getMediaStatus, removeSavedItem, saveSavedItem, saveWatched],
  )

  const value = useMemo(
    () => ({
      items,
      loading: library.isLoading,
      isFavorite,
      isWatched,
      getMediaStatus,
      setMediaStatus,
      toggleFavorite,
      toggleWatched,
    }),
    [items, library.isLoading, isFavorite, isWatched, getMediaStatus, setMediaStatus, toggleFavorite, toggleWatched],
  )

  useEffect(() => {
    if (library.error) {
      toast.error(library.error instanceof Error ? library.error.message : t('favoritesLoadFailed'))
    }
  }, [library.error, t])

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>
}

export function useLibrary() {
  const context = useContext(LibraryContext)
  if (!context) throw new Error('LibraryProvider is missing.')
  return context
}

function getMediaKey(item: Pick<MediaSearchItem, 'id' | 'kind'>) {
  return `${item.kind}:${item.id}`
}
