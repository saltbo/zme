import type { MusicCollectionSummary } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Disc3, Download, ListMusic, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { LibraryNavigation } from '@/components/library/library-navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { getMusicCollection, listMusicCollections, removeMusicCollection } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

const collectionSkeletonKeys = Array.from({ length: 10 }, (_, index) => `music-collection-skeleton-${index + 1}`)

export function MusicLibraryCollectionsPage({ kind }: { kind: 'playlist' | 'album' }) {
  const { t } = useTranslation()
  const collections = useQuery({
    queryKey: queryKeys.music.library(kind),
    queryFn: async () => (await listMusicCollections(kind)).items,
  })

  return (
    <main className="mx-auto w-full min-w-0 max-w-[1680px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <LibraryNavigation musicKind={kind} />
      <div className="mb-5 flex items-end justify-between gap-4 border-b pb-4">
        <div>
          <div className="font-semibold text-sm text-muted-foreground">
            {kind === 'playlist' ? t('playlists') : t('albums')}
          </div>
          <div className="mt-1 text-muted-foreground text-sm">
            {t('collectionCount', { count: collections.data?.length ?? 0 })}
          </div>
        </div>
        <Button variant="outline" render={<Link to="/settings" />}>
          {t('manageConnectors')}
        </Button>
      </div>
      {collections.isLoading ? <CollectionGridSkeleton /> : null}
      {collections.data?.length ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {collections.data.map((item) => (
            <MusicCollectionCard key={item.id} item={item} />
          ))}
        </div>
      ) : null}
      {!collections.isLoading && !collections.data?.length ? (
        <Card className="flex min-h-80 flex-col items-center justify-center gap-3 p-8 text-center">
          {kind === 'playlist' ? (
            <ListMusic className="size-10 text-muted-foreground" />
          ) : (
            <Disc3 className="size-10 text-muted-foreground" />
          )}
          <div className="font-medium">{kind === 'playlist' ? t('noMusicPlaylists') : t('noMusicAlbums')}</div>
          <div className="max-w-md text-muted-foreground text-sm">
            {kind === 'playlist' ? t('noMusicPlaylistsDescription') : t('noMusicAlbumsDescription')}
          </div>
        </Card>
      ) : null}
    </main>
  )
}

export function MusicCollectionDetailPage() {
  const { t } = useTranslation()
  const { collectionId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const collection = useQuery({
    queryKey: queryKeys.music.collection(collectionId),
    queryFn: async () => (await getMusicCollection(collectionId)).item,
    enabled: Boolean(collectionId),
  })
  const remove = useMutation({
    mutationFn: () => removeMusicCollection(collectionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['music', 'library'] })
      navigate(`/library/music/${collection.data?.kind === 'album' ? 'albums' : 'playlists'}`)
      toast.success(t('collectionRemoved'))
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t('collectionRemoveFailed')),
  })

  if (collection.isLoading) return <CollectionDetailSkeleton />
  if (!collection.data) {
    return <main className="p-8 text-center text-muted-foreground">{t('musicCollectionNotFound')}</main>
  }

  const item = collection.data
  const musicKind = item.kind === 'album' ? 'album' : 'playlist'
  const title = item.kind === 'favorites' ? t('favoriteSongs') : item.title
  return (
    <main className="mx-auto w-full min-w-0 max-w-[1400px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <LibraryNavigation musicKind={musicKind} />
      <Button variant="ghost" render={<Link to={`/library/music/${musicKind === 'album' ? 'albums' : 'playlists'}`} />}>
        <ArrowLeft />
        {t('back')}
      </Button>
      <section className="mt-4 flex flex-col gap-5 border-b pb-6 sm:flex-row">
        <CollectionCover item={item} className="size-40 shrink-0 sm:size-48" />
        <div className="min-w-0 flex-1 self-end">
          <div className="font-medium text-muted-foreground text-sm">
            {item.kind === 'album' ? t('album') : t('playlist')}
          </div>
          <h1 className="mt-2 text-balance font-semibold text-3xl sm:text-4xl">{title}</h1>
          {item.ownerName ? <p className="mt-2 text-muted-foreground">{item.ownerName}</p> : null}
          <p className="mt-3 text-muted-foreground text-sm">{t('trackCount', { count: item.tracks.length })}</p>
        </div>
        <Button variant="outline" onClick={() => remove.mutate()} disabled={remove.isPending}>
          <Trash2 />
          {t('removeFromLibrary')}
        </Button>
      </section>
      <div className="mt-4 divide-y rounded-xl border">
        {item.tracks.map((track) => (
          <div
            key={track.id}
            className="grid grid-cols-[2rem_minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-3 sm:px-4"
          >
            <span className="text-right text-muted-foreground text-sm">{track.position}</span>
            <div className="min-w-0">
              <div className="truncate font-medium text-sm">{track.title}</div>
              <div className="truncate text-muted-foreground text-xs">
                {track.artists.join(', ') || t('unknownArtist')}
              </div>
            </div>
            <span className="hidden text-muted-foreground text-xs sm:block">{formatDuration(track.durationMs)}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled
              title={t('downloadComingSoon')}
              aria-label={t('downloadComingSoon')}
            >
              <Download />
            </Button>
          </div>
        ))}
      </div>
    </main>
  )
}

function MusicCollectionCard({ item }: { item: MusicCollectionSummary }) {
  const { t } = useTranslation()
  const segment = item.kind === 'album' ? 'albums' : 'playlists'
  const title = item.kind === 'favorites' ? t('favoriteSongs') : item.title
  return (
    <Link to={`/library/music/${segment}/${item.id}`} className="group min-w-0">
      <CollectionCover
        item={item}
        className="aspect-square w-full transition-transform duration-300 group-hover:-translate-y-1"
      />
      <div className="mt-3 truncate font-medium text-sm">{title}</div>
      <div className="mt-1 text-muted-foreground text-xs">{t('trackCount', { count: item.trackCount })}</div>
    </Link>
  )
}

function CollectionCover({ item, className }: { item: MusicCollectionSummary; className: string }) {
  return item.coverUrl ? (
    <img
      src={item.coverUrl}
      alt=""
      className={`${className} rounded-xl object-cover shadow-lg ring-1 ring-foreground/10`}
    />
  ) : (
    <div
      className={`${className} flex items-center justify-center rounded-xl bg-muted text-muted-foreground ring-1 ring-foreground/10`}
    >
      {item.kind === 'album' ? <Disc3 className="size-10" /> : <ListMusic className="size-10" />}
    </div>
  )
}

function CollectionGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {collectionSkeletonKeys.map((key) => (
        <Skeleton key={key} className="aspect-square rounded-xl" />
      ))}
    </div>
  )
}

function CollectionDetailSkeleton() {
  return (
    <main className="mx-auto max-w-[1400px] p-6">
      <Skeleton className="h-52 rounded-xl" />
      <Skeleton className="mt-6 h-80 rounded-xl" />
    </main>
  )
}

function formatDuration(durationMs: number | null) {
  if (!durationMs) return '--:--'
  const totalSeconds = Math.round(durationMs / 1000)
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}
