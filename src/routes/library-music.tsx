import type {
  DownloaderSummary,
  MusicAvailabilityReason,
  MusicCollectionSummary,
  MusicLibraryTrack,
  MusicSubscriptionSummary,
} from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarDays,
  Disc3,
  Download,
  HardDriveDownload,
  ListMusic,
  LoaderCircle,
  RadioTower,
  Trash2,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useOutletContext, useParams } from 'react-router'
import { toast } from 'sonner'
import type { AppOutletContext } from '@/components/app-shell/types'
import { MusicLibraryNavigation } from '@/components/library/library-navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { findMusicConnectorUiModule } from '@/features/music-connectors/registry'
import { useDownloaders } from '@/hooks/use-downloader-queries'
import {
  disableMusicCollectionSubscription,
  enableMusicCollectionSubscription,
  getMusicCollection,
  listConnectors,
  listMusicCollections,
  removeMusicCollection,
  submitMusicTrackDownload,
} from '@/lib/api'
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
      <MusicLibraryNavigation kind={kind} count={collections.data?.length ?? 0} />
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
  const { i18n, t } = useTranslation()
  const { collectionId = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { setTopbarOverride } = useOutletContext<AppOutletContext>()
  const queryClient = useQueryClient()
  const downloaders = useDownloaders()
  const connectors = useQuery({
    queryKey: queryKeys.connectors.root,
    queryFn: async () => (await listConnectors()).items,
  })
  const [subscriptionDialogOpen, setSubscriptionDialogOpen] = useState(false)
  const [subscriptionDownloaderId, setSubscriptionDownloaderId] = useState('')
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
  const enableSubscription = useMutation({
    mutationFn: () =>
      enableMusicCollectionSubscription(collectionId, {
        downloaderId: subscriptionDownloaderId,
      }),
    onSuccess: async ({ item }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.music.collection(collectionId) })
      setSubscriptionDialogOpen(false)
      toast.success(t('musicSubscriptionEnabled', { count: item.queued }))
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t('musicSubscriptionEnableFailed')),
  })
  const disableSubscription = useMutation({
    mutationFn: () => disableMusicCollectionSubscription(collectionId),
    onSuccess: async ({ item }) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.music.collection(collectionId) })
      toast.success(t('musicSubscriptionDisabled', { count: item.canceled }))
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t('musicSubscriptionDisableFailed')),
  })

  useEffect(() => {
    if (!collection.data) return

    const item = collection.data
    const title = item.kind === 'favorites' ? t('favoriteSongs') : item.title
    setTopbarOverride({
      pathname: location.pathname,
      title,
      subtitle: `${item.kind === 'album' ? t('album') : t('playlist')} / ${item.ownerName ?? t('unknownArtist')}`,
    })

    return () => setTopbarOverride(null)
  }, [collection.data, location.pathname, setTopbarOverride, t])

  if (collection.isLoading) return <CollectionDetailSkeleton />
  if (!collection.data) {
    return <main className="p-8 text-center text-muted-foreground">{t('musicCollectionNotFound')}</main>
  }

  const item = collection.data
  const httpDownloaders = (downloaders.data ?? []).filter(
    (downloader) => downloader.enabled && downloader.supportedSourceTypes.includes('http'),
  )
  const title = item.kind === 'favorites' ? t('favoriteSongs') : item.title
  const downloadableProviders = new Set(
    connectors.data
      ?.filter(
        (connector) =>
          connector.enabled &&
          connector.status === 'connected' &&
          connector.capabilities.includes('music.tracks.download'),
      )
      .map((connector) => connector.kind),
  )
  const canSubscribe = item.kind === 'playlist' && downloadableProviders.has(item.provider)

  function openSubscriptionDialog() {
    const downloaderId = item.subscription?.downloaderId ?? httpDownloaders[0]?.id ?? ''
    setSubscriptionDownloaderId(downloaderId)
    setSubscriptionDialogOpen(true)
  }

  return (
    <main className="mx-auto w-full min-w-0 max-w-[1520px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <MusicCollectionHero
        item={item}
        title={title}
        language={i18n.language}
        subscription={item.subscription}
        canSubscribe={canSubscribe}
        subscriptionPending={enableSubscription.isPending || disableSubscription.isPending}
        onSubscriptionChange={(enabled) => (enabled ? openSubscriptionDialog() : disableSubscription.mutate())}
        removing={remove.isPending}
        onRemove={() => remove.mutate()}
      />

      <MusicSubscriptionDialog
        open={subscriptionDialogOpen}
        downloaders={httpDownloaders}
        downloaderId={subscriptionDownloaderId}
        trackCount={item.tracks.length}
        saving={enableSubscription.isPending}
        onOpenChange={setSubscriptionDialogOpen}
        onDownloaderChange={setSubscriptionDownloaderId}
        onSubmit={() => enableSubscription.mutate()}
      />

      <section className="mt-7">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="font-semibold text-xl sm:text-2xl">{t('trackList')}</h2>
            <p className="mt-1 text-muted-foreground text-sm">{t('trackCount', { count: item.tracks.length })}</p>
          </div>
        </div>
        <div className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
          {item.tracks.map((track) => (
            <div
              key={track.id}
              className="grid min-h-16 grid-cols-[2rem_minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-3 sm:px-4"
            >
              <span className="text-right text-muted-foreground text-sm tabular-nums">{track.position}</span>
              <div className="min-w-0">
                <div className="truncate font-medium text-sm">{track.title}</div>
                <div className="flex min-w-0 items-center gap-2 text-muted-foreground text-xs">
                  <span className="truncate">{track.artists.join(', ') || t('unknownArtist')}</span>
                  {downloadableProviders.has(track.provider) && track.downloadStatus === 'unavailable' ? (
                    <span className="shrink-0 text-destructive">
                      {track.downloadReason
                        ? t(musicAvailabilityReasonKeys[track.downloadReason])
                        : t('musicTrackUnavailable')}
                    </span>
                  ) : downloadableProviders.has(track.provider) && track.downloadStatus === 'unknown' ? (
                    <span className="shrink-0">
                      {track.downloadReason
                        ? t(musicAvailabilityReasonKeys[track.downloadReason])
                        : t('musicTrackUnknown')}
                    </span>
                  ) : null}
                  {track.downloadRecord ? <MusicDownloadRecordBadge status={track.downloadRecord.status} /> : null}
                </div>
              </div>
              <span className="hidden text-muted-foreground text-xs tabular-nums sm:block">
                {formatDuration(track.durationMs)}
              </span>
              <MusicTrackDownloadButton
                track={track}
                supported={downloadableProviders.has(track.provider)}
                downloaders={httpDownloaders}
                loadingDownloaders={downloaders.isLoading}
                onSettled={() => queryClient.invalidateQueries({ queryKey: queryKeys.music.collection(collectionId) })}
              />
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

function MusicCollectionHero({
  item,
  title,
  language,
  subscription,
  canSubscribe,
  subscriptionPending,
  onSubscriptionChange,
  removing,
  onRemove,
}: {
  item: MusicCollectionSummary
  title: string
  language: string
  subscription: MusicSubscriptionSummary | null
  canSubscribe: boolean
  subscriptionPending: boolean
  onSubscriptionChange: (enabled: boolean) => void
  removing: boolean
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const collectionType = item.kind === 'album' ? t('album') : t('playlist')
  const connectorUi = findMusicConnectorUiModule(item.provider)
  const provider = connectorUi ? t(connectorUi.titleKey) : item.provider === 'musicbrainz' ? 'MusicBrainz' : 'ZME'
  const owner = item.ownerName ?? t('unknownArtist')

  return (
    <section className="overflow-hidden rounded-[28px] bg-[#130d1f] text-white shadow-[0_30px_90px_rgba(33,22,47,0.28)] sm:rounded-[34px]">
      <div className="relative">
        {item.coverUrl ? (
          <img
            src={item.coverUrl}
            alt=""
            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-22 blur-2xl"
          />
        ) : null}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(19,13,31,.72)_0%,#130d1f_82%)] lg:bg-[linear-gradient(90deg,#130d1f_0%,rgba(19,13,31,.94)_34%,rgba(19,13,31,.74)_72%,#130d1f_100%)]" />

        <div className="relative grid gap-5 p-4 sm:p-5 lg:min-h-[440px] lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start lg:gap-8 lg:p-8">
          <div className="grid grid-cols-[116px_minmax(0,1fr)] gap-4 sm:grid-cols-[156px_minmax(0,1fr)] lg:block">
            <CollectionCover item={item} className="aspect-square w-full lg:rounded-[30px]" />

            <div className="min-w-0 lg:hidden">
              <div className="flex items-start justify-between gap-2">
                <CollectionTypeBadge kind={item.kind} label={collectionType} />
                <div className="flex items-center gap-2">
                  {canSubscribe ? (
                    <MusicSubscriptionSwitch
                      checked={subscription?.enabled ?? false}
                      pending={subscriptionPending}
                      onCheckedChange={onSubscriptionChange}
                      compact
                    />
                  ) : null}
                  <RemoveCollectionButton removing={removing} onRemove={onRemove} />
                </div>
              </div>
              <h1 className="mt-4 text-balance font-semibold text-2xl leading-tight sm:text-4xl sm:leading-[0.98]">
                {title}
              </h1>
              <p className="mt-3 line-clamp-2 text-sm text-white/68">{owner}</p>
            </div>
          </div>

          <div className="min-w-0 lg:pt-2">
            <div className="mb-8 hidden items-center justify-between gap-6 lg:flex">
              <CollectionTypeBadge kind={item.kind} label={collectionType} />
              <div className="flex items-center gap-3">
                {canSubscribe ? (
                  <MusicSubscriptionSwitch
                    checked={subscription?.enabled ?? false}
                    pending={subscriptionPending}
                    onCheckedChange={onSubscriptionChange}
                  />
                ) : null}
                <RemoveCollectionButton removing={removing} onRemove={onRemove} />
              </div>
            </div>

            <div className="hidden lg:block">
              <h1 className="max-w-4xl text-balance font-semibold text-4xl leading-none sm:text-5xl lg:text-6xl">
                {title}
              </h1>
              <p className="mt-4 max-w-3xl text-lg text-white/70">{owner}</p>
            </div>

            {item.description ? (
              <p className="mt-5 line-clamp-6 max-w-4xl text-white/78 leading-7 sm:text-lg sm:leading-8 lg:mt-6 lg:line-clamp-7">
                {item.description}
              </p>
            ) : null}

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <CollectionFact icon={<ListMusic />} label={t('tracks')} value={String(item.trackCount)} />
              <CollectionFact icon={<Disc3 />} label={t('source')} value={provider} />
              <CollectionFact
                icon={<CalendarDays />}
                label={t('lastSynced')}
                value={item.lastSyncedAt ? formatCollectionDate(item.lastSyncedAt, language) : t('neverSynced')}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function CollectionTypeBadge({ kind, label }: { kind: MusicCollectionSummary['kind']; label: string }) {
  return (
    <Badge variant="secondary" className="gap-2 bg-white/12 text-white/82 backdrop-blur">
      {kind === 'album' ? <Disc3 className="size-3.5" /> : <ListMusic className="size-3.5" />}
      {label}
    </Badge>
  )
}

function MusicSubscriptionSwitch({
  checked,
  pending,
  compact = false,
  onCheckedChange,
}: {
  checked: boolean
  pending: boolean
  compact?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const { t } = useTranslation()
  const switchId = useId()
  return (
    <label
      htmlFor={switchId}
      className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-white/12 px-3 text-sm text-white/88 ring-1 ring-white/10 backdrop-blur"
    >
      <RadioTower className="size-4" />
      {compact ? <span className="sr-only">{t('automaticDownload')}</span> : <span>{t('automaticDownload')}</span>}
      <Switch id={switchId} checked={checked} disabled={pending} onCheckedChange={onCheckedChange} />
    </label>
  )
}

function MusicSubscriptionDialog({
  open,
  downloaders,
  downloaderId,
  trackCount,
  saving,
  onOpenChange,
  onDownloaderChange,
  onSubmit,
}: {
  open: boolean
  downloaders: DownloaderSummary[]
  downloaderId: string
  trackCount: number
  saving: boolean
  onOpenChange: (open: boolean) => void
  onDownloaderChange: (value: string) => void
  onSubmit: () => void
}) {
  const { t } = useTranslation()
  const downloaderItems = downloaders.map((downloader) => ({
    label: downloader.description || downloader.kind,
    value: downloader.id,
  }))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('enableAutomaticDownload')}</DialogTitle>
          <DialogDescription>{t('automaticDownloadDescription', { count: trackCount })}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit()
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel>{t('downloader')}</FieldLabel>
              <Select
                items={downloaderItems}
                value={downloaderId}
                onValueChange={(value) => onDownloaderChange(value ?? '')}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('chooseDownloader')} />
                </SelectTrigger>
                <SelectContent align="start" alignItemWithTrigger={false}>
                  <SelectGroup>
                    {downloaderItems.map((downloader) => (
                      <SelectItem key={downloader.value} value={downloader.value}>
                        {downloader.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {downloaders.length === 0 ? <FieldDescription>{t('noHttpDownloaders')}</FieldDescription> : null}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={saving || !downloaderId}>
              {saving ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
              {t('enable')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MusicDownloadRecordBadge({ status }: { status: NonNullable<MusicLibraryTrack['downloadRecord']>['status'] }) {
  const { t } = useTranslation()
  return (
    <Badge variant={status === 'failed' ? 'destructive' : status === 'accepted' ? 'default' : 'secondary'}>
      {t(`musicRecordStatus_${status}`)}
    </Badge>
  )
}

function RemoveCollectionButton({ removing, onRemove }: { removing: boolean; onRemove: () => void }) {
  const { t } = useTranslation()

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-lg"
      className="size-11 shrink-0 rounded-xl border-white/18 bg-white/12 text-white shadow-lg backdrop-blur hover:bg-destructive hover:text-destructive-foreground"
      onClick={onRemove}
      disabled={removing}
      aria-label={t('removeFromLibrary')}
      title={t('removeFromLibrary')}
    >
      {removing ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
    </Button>
  )
}

function CollectionFact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10 backdrop-blur">
      <div className="flex items-center gap-2 text-white/58 text-xs">
        <span className="[&_svg]:size-4">{icon}</span>
        {label}
      </div>
      <div className="mt-2 truncate font-medium text-sm text-white/88" title={value}>
        {value}
      </div>
    </div>
  )
}

function MusicTrackDownloadButton({
  track,
  supported,
  downloaders,
  loadingDownloaders,
  onSettled,
}: {
  track: MusicLibraryTrack
  supported: boolean
  downloaders: DownloaderSummary[]
  loadingDownloaders: boolean
  onSettled: () => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [submittingDownloaderId, setSubmittingDownloaderId] = useState<string | null>(null)
  const [redownloadTarget, setRedownloadTarget] = useState<DownloaderSummary | null>(null)
  const available = supported && track.downloadStatus !== 'unavailable'
  const submitting = submittingDownloaderId !== null
  const dispatching = ['queued', 'resolving', 'submitting'].includes(track.downloadRecord?.status ?? '')
  const label = !available
    ? t('musicDownloadUnavailable')
    : dispatching
      ? t(`musicRecordStatus_${track.downloadRecord?.status}`)
      : loadingDownloaders
        ? t('loadingDownloaders')
        : downloaders.length === 0
          ? t('noDownloadersAvailable')
          : t('downloadTo')

  async function handleDownload(downloader: DownloaderSummary, force = false) {
    setSubmittingDownloaderId(downloader.id)
    try {
      await submitMusicTrackDownload(track.mediaKey, {
        downloaderId: downloader.id,
        releaseId: track.release?.id,
        force,
      })
      toast.success(t('downloadQueued'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('downloadSubmitFailed'))
    } finally {
      await onSettled()
      setSubmittingDownloaderId(null)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={!available || loadingDownloaders || downloaders.length === 0 || submitting || dispatching}
              title={label}
              aria-label={label}
            />
          }
        >
          {submitting ? <LoaderCircle className="animate-spin" /> : <Download />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('chooseDownloader')}</DropdownMenuLabel>
            {downloaders.map((downloader) => (
              <DropdownMenuItem
                key={downloader.id}
                onClick={() => {
                  if (track.downloadRecord?.status === 'accepted') {
                    setRedownloadTarget(downloader)
                    return
                  }
                  void handleDownload(downloader)
                }}
              >
                <HardDriveDownload />
                <span className="truncate">{downloader.description || downloader.kind}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={redownloadTarget !== null} onOpenChange={(open) => !open && setRedownloadTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('musicRedownloadTitle')}</DialogTitle>
            <DialogDescription>{t('musicRedownloadDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRedownloadTarget(null)}>
              {t('cancel')}
            </Button>
            <Button
              type="button"
              disabled={submitting}
              onClick={() => {
                if (!redownloadTarget) return
                const downloader = redownloadTarget
                setRedownloadTarget(null)
                void handleDownload(downloader, true)
              }}
            >
              {t('musicRedownloadConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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

const musicAvailabilityReasonKeys = {
  membership_required: 'musicAvailabilityReason_membership_required',
  purchase_required: 'musicAvailabilityReason_purchase_required',
  trial_only: 'musicAvailabilityReason_trial_only',
  region_restricted: 'musicAvailabilityReason_region_restricted',
  removed_or_unlicensed: 'musicAvailabilityReason_removed_or_unlicensed',
  authentication_required: 'musicAvailabilityReason_authentication_required',
  risk_control: 'musicAvailabilityReason_risk_control',
  rate_limited: 'musicAvailabilityReason_rate_limited',
  provider_unavailable: 'musicAvailabilityReason_provider_unavailable',
  provider_error: 'musicAvailabilityReason_provider_error',
  malformed_response: 'musicAvailabilityReason_malformed_response',
} as const satisfies Record<MusicAvailabilityReason, string>

function formatCollectionDate(value: string, language: string) {
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(value))
}
