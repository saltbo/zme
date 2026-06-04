import type { DownloaderSummary, IndexerSearchItem, MediaSearchItem } from '@shared/types'
import dayjs from 'dayjs'
import {
  AlertTriangle,
  Database,
  Download,
  HardDriveDownload,
  LoaderCircle,
  RefreshCw,
  Search,
  ServerOff,
  SlidersHorizontal,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useDownloaders } from '@/hooks/use-downloader-queries'
import { createDownload } from '@/lib/api'
import { cn, formatBytes } from '@/lib/utils'

const releaseSkeletonKeys = ['release-skeleton-1', 'release-skeleton-2', 'release-skeleton-3', 'release-skeleton-4']

export interface ReleaseSearchError {
  title: string
  description: string
  action: string
  tone: 'configuration' | 'connection' | 'generic'
}

type ReleaseSort = 'seeders' | 'date' | 'size-desc' | 'size-asc'
type ReleaseQuality = 'all' | '2160p' | '1080p' | '720p' | 'other'

export function ReleaseSearchDialog({
  media,
  query,
  items,
  loading,
  error,
  onClose,
  onSearch,
}: {
  media: MediaSearchItem
  query: string
  items: IndexerSearchItem[]
  loading: boolean
  error: ReleaseSearchError | null
  onClose: () => void
  onSearch: () => void
}) {
  const isDesktop = useIsDesktop()
  const content = (
    <ReleaseSearchContent
      media={media}
      query={query}
      items={items}
      loading={loading}
      error={error}
      onSearch={onSearch}
    />
  )

  if (isDesktop) {
    return (
      <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
        <DialogContent className="h-[calc(100vh-4rem)] max-w-6xl gap-0 overflow-hidden p-0 sm:max-w-6xl">
          {content}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Sheet open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[calc(100vh-1rem)] w-full gap-0 overflow-hidden rounded-t-xl border bg-background p-0 data-[side=bottom]:h-[calc(100vh-1rem)]"
      >
        {content}
      </SheetContent>
    </Sheet>
  )
}

function ReleaseSearchContent({
  media,
  query,
  items,
  loading,
  error,
  onSearch,
}: {
  media: MediaSearchItem
  query: string
  items: IndexerSearchItem[]
  loading: boolean
  error: ReleaseSearchError | null
  onSearch: () => void
}) {
  const { t } = useTranslation()
  const contentRef = useRef<HTMLDivElement>(null)
  const [keyword, setKeyword] = useState('')
  const [indexer, setIndexer] = useState('all')
  const [quality, setQuality] = useState<ReleaseQuality>('all')
  const [sort, setSort] = useState<ReleaseSort>('seeders')
  const downloaders = useDownloaders()
  const indexers = getReleaseIndexers(items)
  const indexerItems = [
    { label: t('allIndexers'), value: 'all' },
    ...indexers.map((item) => ({ label: item, value: item })),
  ]
  const qualityItems = [
    { label: t('allQualities'), value: 'all' },
    { label: '2160p / 4K', value: '2160p' },
    { label: '1080p', value: '1080p' },
    { label: '720p', value: '720p' },
    { label: t('otherQuality'), value: 'other' },
  ]
  const sortItems = [
    { label: t('sortBySeeders'), value: 'seeders' },
    { label: t('sortByDate'), value: 'date' },
    { label: t('sortByLargest'), value: 'size-desc' },
    { label: t('sortBySmallest'), value: 'size-asc' },
  ]
  const visibleItems = filterReleases({ items, keyword, indexer, quality, sort })
  const status = getReleaseStatus({ loading, error, resultCount: visibleItems.length, t })
  const hasFilters = keyword.trim().length > 0 || indexer !== 'all' || quality !== 'all'
  const enabledDownloaders = (downloaders.data ?? []).filter((item) => item.enabled)

  useEffect(() => {
    if (downloaders.error) {
      toast.error(downloaders.error instanceof Error ? downloaders.error.message : t('downloadersLoadFailed'))
    }
  }, [downloaders.error, t])

  return (
    <div ref={contentRef} tabIndex={-1} className="flex h-full min-h-0 flex-col outline-none">
      <div className="border-b bg-card py-3 pr-14 pl-4 sm:pr-16 sm:pl-5">
        <DialogHeader className="hidden md:block">
          <div className="flex flex-row items-center justify-between gap-3">
            <ReleaseTitle media={media} query={query} />
            <ReleaseStatusPill status={status} />
          </div>
        </DialogHeader>
        <SheetHeader className="p-0 md:hidden">
          <div className="flex flex-col gap-3">
            <ReleaseTitle media={media} query={query} mobile />
            <ReleaseStatusPill status={status} />
          </div>
        </SheetHeader>
      </div>

      <div className="border-b bg-muted/30 px-4 py-3 sm:px-5">
        <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_150px_130px_160px_auto] lg:items-center">
          <div className="relative min-w-0">
            <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-4 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={t('filterReleases')}
              className="pl-8"
            />
          </div>

          <Select items={indexerItems} value={indexer} onValueChange={(value) => setIndexer(value || 'all')}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('allIndexers')} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">{t('allIndexers')}</SelectItem>
                {indexers.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          <Select
            items={qualityItems}
            value={quality}
            onValueChange={(value) => setQuality((value || 'all') as ReleaseQuality)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('allQualities')} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">{t('allQualities')}</SelectItem>
                <SelectItem value="2160p">2160p / 4K</SelectItem>
                <SelectItem value="1080p">1080p</SelectItem>
                <SelectItem value="720p">720p</SelectItem>
                <SelectItem value="other">{t('otherQuality')}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>

          <Select
            items={sortItems}
            value={sort}
            onValueChange={(value) => setSort((value || 'seeders') as ReleaseSort)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('sortReleases')} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="seeders">{t('sortBySeeders')}</SelectItem>
                <SelectItem value="date">{t('sortByDate')}</SelectItem>
                <SelectItem value="size-desc">{t('sortByLargest')}</SelectItem>
                <SelectItem value="size-asc">{t('sortBySmallest')}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>

          <Button
            type="button"
            onClick={onSearch}
            variant={error ? 'default' : 'outline'}
            className="lg:justify-self-end"
          >
            {loading ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : (
              <RefreshCw data-icon="inline-start" />
            )}
            {error ? t('retrySearch') : t('searchAgain')}
          </Button>
        </div>
        {!loading && !error ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
            <SlidersHorizontal className="size-3.5" />
            <span>{t('showingReleases', { shown: visibleItems.length, total: items.length })}</span>
            {hasFilters ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => {
                  setKeyword('')
                  setIndexer('all')
                  setQuality('all')
                }}
              >
                {t('clearFilters')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-5">
        <ReleasePanel
          items={visibleItems}
          loading={loading}
          error={error}
          onRetry={onSearch}
          filtered={hasFilters}
          downloaders={enabledDownloaders}
          loadingDownloaders={downloaders.isLoading}
        />
      </div>
    </div>
  )
}

function ReleaseTitle({ media, query, mobile }: { media: MediaSearchItem; query: string; mobile?: boolean }) {
  const { t } = useTranslation()

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Database />
      </div>
      <div className="min-w-0">
        {mobile ? (
          <>
            <SheetTitle className="truncate text-base">{media.title}</SheetTitle>
            <SheetDescription className="truncate text-xs">
              {t('indexerSearch')} · {query}
            </SheetDescription>
          </>
        ) : (
          <>
            <DialogTitle className="truncate text-base">{media.title}</DialogTitle>
            <DialogDescription className="truncate text-xs">
              {t('indexerSearch')} · {query}
            </DialogDescription>
          </>
        )}
      </div>
    </div>
  )
}

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(min-width: 768px)').matches,
  )

  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)')
    const update = () => setIsDesktop(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return isDesktop
}

function getReleaseStatus({
  loading,
  error,
  resultCount,
  t,
}: {
  loading: boolean
  error: ReleaseSearchError | null
  resultCount: number
  t: (key: string) => string
}) {
  if (loading) {
    return {
      icon: <LoaderCircle className="size-4 animate-spin" />,
      label: t('searchingIndexers'),
      className: 'bg-primary/10 text-primary',
    }
  }

  if (error) {
    return {
      icon: error.tone === 'configuration' ? <ServerOff className="size-4" /> : <AlertTriangle className="size-4" />,
      label: error.tone === 'configuration' ? t('configurationNeeded') : t('searchUnavailable'),
      className: 'bg-destructive/10 text-destructive',
    }
  }

  return {
    icon: <Database className="size-4" />,
    label: `${resultCount} ${t('results')}`,
    className: resultCount > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
  }
}

function ReleaseStatusPill({
  status,
}: {
  status: {
    icon: ReactNode
    label: string
    className: string
  }
}) {
  return (
    <div
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3 font-medium text-sm',
        status.className,
      )}
    >
      {status.icon}
      <span>{status.label}</span>
    </div>
  )
}

function ReleasePanel({
  downloaders,
  items,
  loading,
  loadingDownloaders,
  error,
  onRetry,
  filtered,
}: {
  downloaders: DownloaderSummary[]
  items: IndexerSearchItem[]
  loading: boolean
  loadingDownloaders: boolean
  error: ReleaseSearchError | null
  onRetry: () => void
  filtered: boolean
}) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <div className="flex flex-col gap-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
        {releaseSkeletonKeys.map((key) => (
          <Card key={key} className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_180px] sm:items-center">
            <CardContent className="px-0">
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="mt-3 h-3 w-1/2" />
              <div className="mt-4 flex gap-2">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
            </CardContent>
            <Skeleton className="h-11 rounded-lg" />
          </Card>
        ))}
      </div>
    )
  }

  if (error) {
    const Icon = error.tone === 'configuration' ? ServerOff : AlertTriangle
    return (
      <Alert
        variant={error.tone === 'generic' ? 'default' : 'destructive'}
        className="min-h-64 items-start rounded-xl p-5 animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
      >
        <Icon className="mt-0.5" />
        <AlertTitle className="text-base">{error.title}</AlertTitle>
        <AlertDescription className="max-w-2xl">{error.description}</AlertDescription>
        <div className="col-start-2 mt-4">
          <Button
            type="button"
            onClick={onRetry}
            size="sm"
            variant={error.tone === 'generic' ? 'outline' : 'destructive'}
          >
            <RefreshCw data-icon="inline-start" />
            {error.action}
          </Button>
        </div>
      </Alert>
    )
  }

  if (items.length === 0) {
    return (
      <Card className="flex min-h-64 items-center justify-center p-6 text-center animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
        <CardContent className="flex max-w-md flex-col items-center px-0">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Search className="size-5" />
          </div>
          <h3 className="mt-4 font-semibold">{filtered ? t('noFilteredReleasesTitle') : t('noReleasesTitle')}</h3>
          <p className="mt-2 text-muted-foreground text-sm">{filtered ? t('noFilteredReleases') : t('noReleases')}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
      {items.map((item) => (
        <ReleaseRow key={item.id} item={item} downloaders={downloaders} loadingDownloaders={loadingDownloaders} />
      ))}
    </div>
  )
}

function ReleaseRow({
  downloaders,
  item,
  loadingDownloaders,
}: {
  downloaders: DownloaderSummary[]
  item: IndexerSearchItem
  loadingDownloaders: boolean
}) {
  const { i18n, t } = useTranslation()
  const [submittingDownloaderId, setSubmittingDownloaderId] = useState<string | null>(null)
  const title = item.fileName || item.title

  async function handleDownload(downloader: DownloaderSummary) {
    const source = getDownloadSource(item)
    if (!source) {
      toast.error(t('releaseMissingUrl'))
      return
    }

    setSubmittingDownloaderId(downloader.id)
    try {
      await createDownload({
        downloaderId: downloader.id,
        uri: source.uri,
        sourceType: source.sourceType,
        title,
      })
      toast.success(t('downloadSubmitted'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('downloadSubmitFailed'))
    } finally {
      setSubmittingDownloaderId(null)
    }
  }

  const submitting = Boolean(submittingDownloaderId)
  const hasSource = Boolean(getDownloadSource(item))
  const disabled = !hasSource || loadingDownloaders || downloaders.length === 0 || submitting

  return (
    <Card className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_180px] sm:items-center">
      <CardContent className="min-w-0 px-0">
        <div className="mb-2 flex flex-wrap gap-2">
          <Badge variant="secondary">{item.indexer}</Badge>
          <Badge variant="outline">
            {item.seeders ?? 0} {t('seeders')}
          </Badge>
          <Badge variant="outline">
            {item.leechers ?? 0} {t('leechers')}
          </Badge>
          {item.protocol ? <Badge variant="outline">{item.protocol}</Badge> : null}
          {item.indexerFlags.map((flag) => (
            <Badge key={flag} variant="secondary">
              {flag}
            </Badge>
          ))}
        </div>
        <h3 className="line-clamp-2 font-semibold text-sm leading-5">{title}</h3>
        <div className="mt-2 flex flex-wrap gap-3 text-muted-foreground text-xs">
          <span>{formatBytes(item.size)}</span>
          <span>{item.files !== null ? t('filesCount', { count: item.files }) : t('unknownFiles')}</span>
          <span>{formatReleaseDate(item.publishDate, i18n.language, t)}</span>
          {item.categories.length > 0 ? <span>{item.categories.slice(0, 2).join(' / ')}</span> : null}
          <span>{item.infoHash ? t('magnetReady') : t('torrentUrl')}</span>
          {item.infoUrl ? (
            <a
              className="font-medium text-primary hover:underline"
              href={item.infoUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t('sourcePage')}
            </a>
          ) : null}
        </div>
      </CardContent>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" size="lg" className="h-11" disabled={disabled} />}>
          {submitting ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" />
          ) : (
            <Download data-icon="inline-start" />
          )}
          {loadingDownloaders
            ? t('loadingDownloaders')
            : downloaders.length === 0
              ? t('noDownloadersAvailable')
              : t('downloadTo')}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('chooseDownloader')}</DropdownMenuLabel>
            {downloaders.map((downloader) => (
              <DropdownMenuItem key={downloader.id} onClick={() => void handleDownload(downloader)}>
                <HardDriveDownload />
                <span className="truncate">{getDownloaderLabel(downloader)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </Card>
  )
}

function getDownloadSource(item: IndexerSearchItem) {
  if (item.magnetUrl) {
    return { uri: item.magnetUrl, sourceType: 'magnet' as const }
  }

  if (item.downloadUrl) {
    return { uri: item.downloadUrl, sourceType: 'torrent_url' as const }
  }

  return null
}

function getReleaseQuality(item: IndexerSearchItem): ReleaseQuality {
  const title = item.title.toLowerCase()

  if (title.includes('2160p') || title.includes('4k') || title.includes('uhd')) return '2160p'
  if (title.includes('1080p')) return '1080p'
  if (title.includes('720p')) return '720p'
  return 'other'
}

function getReleaseIndexers(items: IndexerSearchItem[]) {
  return Array.from(new Set(items.map((item) => item.indexer))).sort((left, right) => left.localeCompare(right))
}

function sortReleases(items: IndexerSearchItem[], sort: ReleaseSort) {
  return [...items].sort((left, right) => {
    if (sort === 'date') {
      return new Date(right.publishDate || 0).getTime() - new Date(left.publishDate || 0).getTime()
    }

    if (sort === 'size-desc') {
      return (right.size || 0) - (left.size || 0)
    }

    if (sort === 'size-asc') {
      return (left.size || 0) - (right.size || 0)
    }

    return (right.seeders || 0) - (left.seeders || 0)
  })
}

function filterReleases({
  items,
  keyword,
  indexer,
  quality,
  sort,
}: {
  items: IndexerSearchItem[]
  keyword: string
  indexer: string
  quality: ReleaseQuality
  sort: ReleaseSort
}) {
  const normalizedKeyword = keyword.trim().toLowerCase()
  const filtered = items.filter((item) => {
    const matchesKeyword =
      normalizedKeyword.length === 0 ||
      item.title.toLowerCase().includes(normalizedKeyword) ||
      item.indexer.toLowerCase().includes(normalizedKeyword)
    const matchesIndexer = indexer === 'all' || item.indexer === indexer
    const matchesQuality = quality === 'all' || getReleaseQuality(item) === quality

    return matchesKeyword && matchesIndexer && matchesQuality
  })

  return sortReleases(filtered, sort)
}

function formatReleaseDate(value: string | null, language: string, t: (key: string) => string) {
  if (!value) return t('unknownDate')

  const publishedAt = dayjs(value)
  if (!publishedAt.isValid()) return t('unknownDate')

  return publishedAt.locale(language === 'zh' ? 'zh-cn' : 'en').fromNow()
}

function getDownloaderLabel(item: DownloaderSummary) {
  const kind =
    item.kind === 'zpan'
      ? 'ZPan'
      : item.kind === 'qbittorrent'
        ? 'qBittorrent'
        : item.kind === 'transmission'
          ? 'Transmission'
          : 'aria2'

  return item.description ? `${kind} · ${item.description}` : kind
}
