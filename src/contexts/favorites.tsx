import type { FavoriteMediaItem, MediaSearchItem } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createFavorite, deleteFavorite, listFavorites } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

interface FavoritesContextValue {
  items: FavoriteMediaItem[]
  loading: boolean
  isFavorite: (item: Pick<MediaSearchItem, 'id' | 'kind'>) => boolean
  toggleFavorite: (item: MediaSearchItem) => Promise<void>
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null)

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const favorites = useQuery({
    queryKey: queryKeys.favorites,
    queryFn: async () => (await listFavorites()).items,
  })
  const items = favorites.data ?? []

  const favoriteKeys = useMemo(() => new Set(items.map((item) => getMediaKey(item))), [items])

  const isFavorite = useCallback(
    (item: Pick<MediaSearchItem, 'id' | 'kind'>) => favoriteKeys.has(getMediaKey(item)),
    [favoriteKeys],
  )

  const saveFavorite = useMutation({
    mutationFn: createFavorite,
    onSuccess: (payload, item) => {
      const key = getMediaKey(item)
      queryClient.setQueryData<FavoriteMediaItem[]>(queryKeys.favorites, (current = []) => [
        payload.item,
        ...current.filter((favorite) => getMediaKey(favorite) !== key),
      ])
      toast.success(t('favoriteAdded'))
    },
  })

  const removeFavorite = useMutation({
    mutationFn: (item: MediaSearchItem) => deleteFavorite(item.kind, item.id),
    onSuccess: (_payload, item) => {
      const key = getMediaKey(item)
      queryClient.setQueryData<FavoriteMediaItem[]>(queryKeys.favorites, (current = []) =>
        current.filter((favorite) => getMediaKey(favorite) !== key),
      )
      toast.success(t('favoriteRemoved'))
    },
  })

  const toggleFavorite = useCallback(
    async (item: MediaSearchItem) => {
      if (favoriteKeys.has(getMediaKey(item))) {
        await removeFavorite.mutateAsync(item)
        return
      }

      await saveFavorite.mutateAsync(item)
    },
    [favoriteKeys, removeFavorite, saveFavorite],
  )

  const value = useMemo(
    () => ({
      items,
      loading: favorites.isLoading,
      isFavorite,
      toggleFavorite,
    }),
    [items, favorites.isLoading, isFavorite, toggleFavorite],
  )

  useEffect(() => {
    if (favorites.error) {
      toast.error(favorites.error instanceof Error ? favorites.error.message : t('favoritesLoadFailed'))
    }
  }, [favorites.error, t])

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>
}

export function useFavorites() {
  const context = useContext(FavoritesContext)
  if (!context) throw new Error('FavoritesProvider is missing.')
  return context
}

function getMediaKey(item: Pick<MediaSearchItem, 'id' | 'kind'>) {
  return `${item.kind}:${item.id}`
}
