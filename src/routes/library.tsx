import type { LibraryFilterKind, LibraryFilterStatus, LibraryStateItem, MediaKind } from '@shared/types'
import { CircleCheck, Film, Heart, RotateCcw, Tv } from 'lucide-react'
import type { MouseEvent } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { type MediaStatus, useLibrary } from '@/contexts/library'
import { useMediaDetails } from '@/hooks/use-media-queries'
import { getTmdbLanguage } from '@/i18n'
import { cn } from '@/lib/utils'
import { LibraryResourceCard } from '@/routes/resource-pages'

type LibrarySort = 'updated' | 'saved' | 'watched'

export function LibraryPage() {
  const { i18n, t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { items: libraryStates, loading } = useLibrary()
  const kind = getKindParam(searchParams.get('kind'))
  const status = getStatusParam(searchParams.get('status'))
  const sort = getSortParam(searchParams.get('sort'))
  const language = getTmdbLanguage(i18n.language)
  const visibleItems = useMemo(
    () =>
      sortLibraryItems(
        libraryStates.filter((item) => matchesLibraryKind(item, kind) && matchesLibraryStatus(item, status)),
        sort,
      ),
    [kind, libraryStates, sort, status],
  )

  function updateKind(value: LibraryFilterKind) {
    updateLibraryParams(setSearchParams, { kind: value, status, sort })
  }

  function updateStatus(value: LibraryFilterStatus) {
    updateLibraryParams(setSearchParams, { kind, status: value, sort })
  }

  function updateSort(value: LibrarySort) {
    updateLibraryParams(setSearchParams, { kind, status, sort: value })
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1680px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <div className="mb-5 flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="font-semibold text-sm text-muted-foreground">{t('myLibrary')}</div>
          <div className="mt-1 text-muted-foreground text-sm">
            {t('libraryResultCount', { count: visibleItems.length })}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3 lg:w-[640px]">
          <LibrarySelect
            label={t('type')}
            items={getKindOptions(t)}
            value={kind}
            onChange={(value) => updateKind((value || 'all') as LibraryFilterKind)}
          />
          <LibrarySelect
            label={t('status')}
            items={getStatusOptions(t)}
            value={status}
            onChange={(value) => updateStatus((value || 'all') as LibraryFilterStatus)}
          />
          <LibrarySelect
            label={t('sort')}
            items={getSortOptions(t)}
            value={sort}
            onChange={(value) => updateSort(getSortParam(value))}
          />
        </div>
      </div>

      {loading ? <LibraryGridSkeleton /> : null}
      {!loading && visibleItems.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-4 sm:gap-y-7 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
          {visibleItems.map((item) => (
            <LibraryStateCard key={item.mediaKey} item={item} language={language} />
          ))}
        </div>
      ) : null}
      {!loading && visibleItems.length === 0 ? (
        <Card className="flex min-h-80 items-center justify-center p-8 text-center text-muted-foreground">
          {t('noLibrary')}
        </Card>
      ) : null}
    </div>
  )
}

function LibraryStateCard({ item, language }: { item: LibraryStateItem; language: string }) {
  if (item.kind === 'music' || item.kind === 'book') {
    return <LibraryResourceCard kind={item.kind} mediaKey={item.mediaKey} />
  }

  return <LibraryMediaCard kind={item.kind} tmdbId={item.id} language={language} mediaKey={item.mediaKey} />
}

function LibraryMediaCard({
  kind,
  tmdbId,
  language,
  mediaKey,
}: {
  kind: MediaKind
  tmdbId: number | null
  language: string
  mediaKey: string
}) {
  const { t } = useTranslation()
  const { getMediaStatus, setMediaStatus } = useLibrary()
  const details = useMediaDetails(kind, tmdbId ?? 0, language)
  const item = details.data ?? null
  const status = item ? getMediaStatus(item) : 'none'

  async function handleStatusChange(nextStatus: MediaStatus) {
    if (!item) return
    try {
      await setMediaStatus(item, nextStatus)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('mediaStatusToggleFailed'))
    }
  }

  if (details.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="aspect-[2/3] rounded-xl" />
        <Skeleton className="mx-1 h-4 w-2/3" />
        <Skeleton className="mx-1 h-3 w-1/2" />
      </div>
    )
  }

  if (!item) {
    return (
      <Card className="flex aspect-[2/3] items-center justify-center break-all p-4 text-center text-muted-foreground text-sm">
        {mediaKey}
      </Card>
    )
  }

  const path = kind === 'movie' ? `/movies/${item.id}` : `/series/${item.id}`
  const meta = [kind === 'movie' ? t('movie') : t('series'), item.releaseYear].filter(Boolean).join(' / ')

  return (
    <Card className="group gap-0 overflow-visible bg-transparent p-0 ring-0">
      <CardContent className="relative aspect-[2/3] overflow-hidden rounded-xl bg-card p-0 shadow-[0_18px_38px_rgba(33,22,47,0.18)] ring-1 ring-foreground/10 transition duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_28px_58px_rgba(124,58,237,0.18)]">
        {item.posterUrl ? (
          <img
            src={item.posterUrl}
            alt={`${item.title} poster`}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            {kind === 'movie' ? <Film className="size-8" /> : <Tv className="size-8" />}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#120c1d] via-[#120c1d]/18 to-transparent opacity-92" />
        <Link to={path} state={{ media: item }} aria-label={item.title} className="absolute inset-0 z-10" />
        <LibraryMediaStatusMenu status={status} onChange={handleStatusChange} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-4 text-white">
          <div className="mb-2 truncate text-white/72 text-xs">{meta}</div>
          <h2 className="line-clamp-2 text-balance font-semibold text-base leading-tight drop-shadow sm:text-xl">
            {item.title}
          </h2>
        </div>
      </CardContent>
      <CardContent className="px-1 pt-3">
        <div className="flex min-w-0 items-center justify-between gap-2 text-muted-foreground text-sm">
          <span className="block max-w-full truncate text-left">{item.title}</span>
          <span className="shrink-0 font-medium text-foreground text-xs">{item.releaseYear ?? 'NR'}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function LibraryMediaStatusMenu({
  status,
  onChange,
}: {
  status: MediaStatus
  onChange: (nextStatus: MediaStatus) => Promise<void>
}) {
  const { t } = useTranslation()

  function handleTriggerClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
  }

  return (
    <div className="absolute top-2 right-2 z-30">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              onPointerDown={handleTriggerClick}
              onClick={handleTriggerClick}
              aria-label={t('mediaStatus')}
              title={t('mediaStatus')}
              className={cn(
                'flex size-10 items-center justify-center text-white/88 drop-shadow-[0_2px_6px_rgba(0,0,0,0.55)] transition hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white md:group-hover:opacity-100',
                status === 'none' && 'opacity-100 hover:text-[#f06595] md:opacity-0',
                status === 'saved' && 'text-[#f06595] opacity-100',
                status === 'watched' && 'text-[#77d6a8] opacity-100',
              )}
            >
              {status === 'watched' ? (
                <CircleCheck className="size-6 fill-[#77d6a8] text-[#123524]" />
              ) : (
                <Heart className={cn('size-6', status === 'saved' && 'fill-[#f06595] text-[#f06595]')} />
              )}
            </button>
          }
        />
        <DropdownMenuContent align="end" className="w-40" onClick={(event) => event.stopPropagation()}>
          <DropdownMenuItem
            onClick={(event) => {
              event.stopPropagation()
              void onChange('saved')
            }}
          >
            <Heart className={cn(status === 'saved' && 'fill-[#f06595] text-[#f06595]')} />
            {t('saveToLibrary')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(event) => {
              event.stopPropagation()
              void onChange('watched')
            }}
          >
            <CircleCheck className={cn(status === 'watched' && 'fill-[#77d6a8] text-[#123524]')} />
            {t('markWatched')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(event) => {
              event.stopPropagation()
              void onChange('none')
            }}
            disabled={status === 'none'}
          >
            <RotateCcw />
            {t('clearMediaStatus')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function LibrarySelect({
  label,
  items,
  value,
  onChange,
}: {
  label: string
  items: { label: string; value: string }[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="min-w-0">
      <span className="mb-1 block font-medium text-muted-foreground text-xs">{label}</span>
      <Select items={items} value={value} onValueChange={(value) => onChange(value || '')}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false}>
          <SelectGroup>
            {items.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

function LibraryGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-4 sm:gap-y-7 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
      {[
        'library-skeleton-1',
        'library-skeleton-2',
        'library-skeleton-3',
        'library-skeleton-4',
        'library-skeleton-5',
      ].map((key) => (
        <div key={key} className="flex flex-col gap-3">
          <Skeleton className="aspect-[2/3] rounded-xl" />
          <Skeleton className="mx-1 h-4 w-2/3" />
          <Skeleton className="mx-1 h-3 w-1/2" />
        </div>
      ))}
    </div>
  )
}

function getKindParam(value: string | null): LibraryFilterKind {
  return value === 'movie' || value === 'tv' || value === 'music' || value === 'book' ? value : 'all'
}

function getStatusParam(value: string | null): LibraryFilterStatus {
  return value === 'unwatched' || value === 'watched' ? value : 'all'
}

function getSortParam(value: string | null): LibrarySort {
  return value === 'saved' || value === 'watched' ? value : 'updated'
}

function matchesLibraryKind(item: LibraryStateItem, kind: LibraryFilterKind) {
  return kind === 'all' || item.kind === kind
}

function matchesLibraryStatus(item: LibraryStateItem, status: LibraryFilterStatus) {
  if (status === 'watched') return Boolean(item.watchedAt)
  if (status === 'unwatched') return Boolean(item.savedAt) && !item.watchedAt
  return Boolean(item.savedAt)
}

function sortLibraryItems(items: LibraryStateItem[], sort: LibrarySort) {
  return [...items].sort((left, right) => {
    if (sort === 'saved')
      return compareDateDesc(left.savedAt, right.savedAt) || compareDateDesc(left.updatedAt, right.updatedAt)
    if (sort === 'watched') {
      return compareDateDesc(left.watchedAt, right.watchedAt) || compareDateDesc(left.updatedAt, right.updatedAt)
    }
    return compareDateDesc(left.updatedAt, right.updatedAt)
  })
}

function compareDateDesc(left: string | null, right: string | null) {
  return getTimestamp(right) - getTimestamp(left)
}

function getTimestamp(value: string | null) {
  const timestamp = Date.parse(value ?? '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

function updateLibraryParams(
  setSearchParams: ReturnType<typeof useSearchParams>[1],
  input: { kind: LibraryFilterKind; status: LibraryFilterStatus; sort: LibrarySort },
) {
  const next = new URLSearchParams()
  if (input.kind !== 'all') next.set('kind', input.kind)
  if (input.status !== 'all') next.set('status', input.status)
  if (input.sort !== 'updated') next.set('sort', input.sort)
  setSearchParams(next)
}

function getKindOptions(t: ReturnType<typeof useTranslation>['t']) {
  return [
    { label: t('allTypes'), value: 'all' },
    { label: t('movies'), value: 'movie' },
    { label: t('series'), value: 'tv' },
    { label: t('music'), value: 'music' },
    { label: t('books'), value: 'book' },
  ]
}

function getStatusOptions(t: ReturnType<typeof useTranslation>['t']) {
  return [
    { label: t('allStatuses'), value: 'all' },
    { label: t('libraryStatusPending'), value: 'unwatched' },
    { label: t('libraryStatusCompleted'), value: 'watched' },
  ]
}

function getSortOptions(t: ReturnType<typeof useTranslation>['t']) {
  return [
    { label: t('sortByRecentlyUpdated'), value: 'updated' },
    { label: t('sortByRecentlySaved'), value: 'saved' },
    { label: t('sortByRecentlyCompleted'), value: 'watched' },
  ]
}
