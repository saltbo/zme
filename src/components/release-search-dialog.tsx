import { toZmeDownloadCategory } from '@shared/download-metadata'
import {
  analyzeIndexerRelease,
  compareIndexerReleasesByRecommendation,
  type IndexerReleaseAnalysis,
  type ReleaseSourceTier,
} from '@shared/release-analysis'
import type { DownloaderSummary, IndexerSearchItem, MediaSearchItem } from '@shared/types'
import dayjs from 'dayjs'
import type { TFunction } from 'i18next'
import {
  AlertTriangle,
  CircleCheck,
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useDownloaders } from '@/hooks/use-downloader-queries'
import { createDownload } from '@/lib/api'
import type { ReleaseSearchProgress } from '@/lib/release-search'
import { cn, formatBytes } from '@/lib/utils'

export interface ReleaseSearchMedia extends MediaSearchItem {
  downloadCategory?: string
  downloadTags?: string[]
}

export interface ReleaseSearchError {
  title: string
  description: string
  action: string
  tone: 'configuration' | 'connection' | 'generic'
}

type ReleaseSort = 'best' | 'seeders' | 'date' | 'size-desc' | 'size-asc'
type ReleaseQuality = 'all' | '2160p' | '1080p' | '720p' | 'other'
type ReleaseSourceFilter = 'all' | 'high' | 'watchable' | 'low' | 'unknown'

export function ReleaseSearchDialog({
  media,
  query,
  items,
  loading,
  error,
  progress,
  onClose,
  onSearch,
}: {
  media: ReleaseSearchMedia
  query: string
  items: IndexerSearchItem[]
  loading: boolean
  error: ReleaseSearchError | null
  progress?: ReleaseSearchProgress | null
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
      progress={progress}
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
  progress,
  onSearch,
}: {
  media: ReleaseSearchMedia
  query: string
  items: IndexerSearchItem[]
  loading: boolean
  error: ReleaseSearchError | null
  progress?: ReleaseSearchProgress | null
  onSearch: () => void
}) {
  const { t } = useTranslation()
  const contentRef = useRef<HTMLDivElement>(null)
  const [keyword, setKeyword] = useState('')
  const [indexer, setIndexer] = useState('all')
  const [quality, setQuality] = useState<ReleaseQuality>('all')
  const [sourceFilter, setSourceFilter] = useState<ReleaseSourceFilter>('all')
  const [sort, setSort] = useState<ReleaseSort>('best')
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
  const sourceItems = [
    { label: t('allSources'), value: 'all' },
    { label: t('highQualitySources'), value: 'high' },
    { label: t('watchableSources'), value: 'watchable' },
    { label: t('lowQualitySources'), value: 'low' },
    { label: t('unknownSources'), value: 'unknown' },
  ]
  const sortItems = [
    { label: t('sortByBest'), value: 'best' },
    { label: t('sortBySeeders'), value: 'seeders' },
    { label: t('sortByDate'), value: 'date' },
    { label: t('sortByLargest'), value: 'size-desc' },
    { label: t('sortBySmallest'), value: 'size-asc' },
  ]
  const visibleItems = filterReleases({ items, keyword, indexer, quality, sourceFilter, sort })
  const status = getReleaseStatus({ loading, error, progress, resultCount: visibleItems.length, t })
  const hasFilters = keyword.trim().length > 0 || indexer !== 'all' || quality !== 'all' || sourceFilter !== 'all'
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
        <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_150px_130px_150px_160px_auto] lg:items-center">
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

          <Select items={sortItems} value={sort} onValueChange={(value) => setSort((value || 'best') as ReleaseSort)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('sortReleases')} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="best">{t('sortByBest')}</SelectItem>
                <SelectItem value="seeders">{t('sortBySeeders')}</SelectItem>
                <SelectItem value="date">{t('sortByDate')}</SelectItem>
                <SelectItem value="size-desc">{t('sortByLargest')}</SelectItem>
                <SelectItem value="size-asc">{t('sortBySmallest')}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>

          <Select
            items={sourceItems}
            value={sourceFilter}
            onValueChange={(value) => setSourceFilter((value || 'all') as ReleaseSourceFilter)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('allSources')} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">{t('allSources')}</SelectItem>
                <SelectItem value="high">{t('highQualitySources')}</SelectItem>
                <SelectItem value="watchable">{t('watchableSources')}</SelectItem>
                <SelectItem value="low">{t('lowQualitySources')}</SelectItem>
                <SelectItem value="unknown">{t('unknownSources')}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>

          <Button
            type="button"
            onClick={onSearch}
            variant={error ? 'default' : 'outline'}
            className="lg:justify-self-end"
            disabled={loading}
          >
            {loading ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : (
              <RefreshCw data-icon="inline-start" />
            )}
            {error ? t('retrySearch') : t('searchAgain')}
          </Button>
        </div>
        {loading && progress ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
            <LoaderCircle className="size-3.5 animate-spin" />
            <span>
              {t(progress.phase === 'fallback' ? 'fallbackSearchProgress' : 'releaseSearchProgress', {
                completed: progress.completed,
                total: progress.total,
                active: progress.active,
              })}
            </span>
          </div>
        ) : null}
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
                  setSourceFilter('all')
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
          media={media}
          items={visibleItems}
          loading={loading}
          progress={progress}
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

function ReleaseTitle({ media, query, mobile }: { media: ReleaseSearchMedia; query: string; mobile?: boolean }) {
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
  progress,
  resultCount,
  t,
}: {
  loading: boolean
  error: ReleaseSearchError | null
  progress?: ReleaseSearchProgress | null
  resultCount: number
  t: (key: string) => string
}) {
  if (loading) {
    return {
      icon: <LoaderCircle className="size-4 animate-spin" />,
      label: progress ? `${progress.completed}/${progress.total}` : t('searchingIndexers'),
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
  media,
  items,
  loading,
  progress,
  loadingDownloaders,
  error,
  onRetry,
  filtered,
}: {
  downloaders: DownloaderSummary[]
  media: ReleaseSearchMedia
  items: IndexerSearchItem[]
  loading: boolean
  progress?: ReleaseSearchProgress | null
  loadingDownloaders: boolean
  error: ReleaseSearchError | null
  onRetry: () => void
  filtered: boolean
}) {
  const { t } = useTranslation()

  if (loading) {
    return <ReleaseSearchProgressPanel progress={progress} />
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
        <ReleaseRow
          key={item.id}
          media={media}
          item={item}
          downloaders={downloaders}
          loadingDownloaders={loadingDownloaders}
        />
      ))}
    </div>
  )
}

function ReleaseSearchProgressPanel({ progress }: { progress?: ReleaseSearchProgress | null }) {
  const { t } = useTranslation()

  if (!progress) {
    return (
      <Card className="flex min-h-64 items-center justify-center p-6 text-center animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
        <CardContent className="flex max-w-md flex-col items-center px-0">
          <LoaderCircle className="size-8 animate-spin text-primary" />
          <h3 className="mt-4 font-semibold">{t('searchingIndexers')}</h3>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="flex min-h-64 items-center justify-center p-4 animate-in fade-in-0 slide-in-from-bottom-2 duration-300 sm:p-6">
      <CardContent className="w-full max-w-3xl px-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">{t('releaseSearchInProgress')}</h3>
            <p className="mt-1 text-muted-foreground text-sm">
              {t(progress.phase === 'fallback' ? 'fallbackSearchProgress' : 'releaseSearchProgress', {
                completed: progress.completed,
                total: progress.total,
                active: progress.active,
              })}
            </p>
          </div>
          <Badge variant="secondary">{t('concurrentSearches', { count: progress.active })}</Badge>
        </div>
        <div className="grid gap-2">
          {progress.steps.map((step) => (
            <div
              key={step.id}
              className="grid min-h-12 grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border bg-background px-3 py-2"
            >
              <ReleaseSearchStepIcon status={step.status} />
              <div className="min-w-0">
                <div className="truncate font-medium text-sm">{step.query}</div>
                <div className="text-muted-foreground text-xs">
                  {t(step.phase === 'fallback' ? 'fallbackSearchPhase' : 'primarySearchPhase')}
                </div>
              </div>
              <div className="shrink-0 text-right text-muted-foreground text-xs">
                {step.status === 'completed'
                  ? t('releaseSearchStepFound', { count: step.resultCount ?? 0 })
                  : step.status === 'failed'
                    ? t('releaseSearchStepFailed')
                    : step.status === 'running'
                      ? t('releaseSearchStepRunning')
                      : t('releaseSearchStepPending')}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function ReleaseSearchStepIcon({ status }: { status: ReleaseSearchProgress['steps'][number]['status'] }) {
  if (status === 'completed') return <CircleCheck className="size-4 text-primary" />
  if (status === 'failed') return <AlertTriangle className="size-4 text-destructive" />
  if (status === 'running') return <LoaderCircle className="size-4 animate-spin text-primary" />
  return <Search className="size-4 text-muted-foreground" />
}

function ReleaseRow({
  downloaders,
  media,
  item,
  loadingDownloaders,
}: {
  downloaders: DownloaderSummary[]
  media: ReleaseSearchMedia
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
        category: media.downloadCategory ?? toZmeDownloadCategory(media.kind),
        tags: getMediaTags(media, item),
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
  const downloadLabel = loadingDownloaders
    ? t('loadingDownloaders')
    : downloaders.length === 0
      ? t('noDownloadersAvailable')
      : t('downloadTo')
  const analysis = analyzeIndexerRelease(item)

  return (
    <Card size="sm" className="grid grid-cols-[minmax(0,1fr)_72px] gap-0 p-0">
      <CardContent className="min-w-0 px-4 py-3">
        <div className="min-w-0 space-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <ReleaseQualityTags analysis={analysis} />
            <ReleaseSpecTags analysis={analysis} />
          </div>

          <h3 className="line-clamp-2 font-semibold text-sm leading-5">{title}</h3>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="font-medium text-foreground">{item.indexer}</span>
            <span className="font-medium text-foreground">
              {item.seeders ?? 0} {t('seeders')}
            </span>
            <span className="text-muted-foreground">
              {item.leechers ?? 0} {t('leechers')}
            </span>
            <span className="text-muted-foreground">{formatBytes(item.size)}</span>
            <span className="text-muted-foreground">
              {item.files !== null ? t('filesCount', { count: item.files }) : t('unknownFiles')}
            </span>
            <span className="text-muted-foreground">{formatReleaseDate(item.publishDate, i18n.language, t)}</span>
            {item.categories.length > 0 ? (
              <span className="text-muted-foreground">{item.categories.slice(0, 2).join(' / ')}</span>
            ) : null}
            <span className="text-muted-foreground">{item.infoHash ? t('magnetReady') : t('torrentUrl')}</span>
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
        </div>
      </CardContent>
      <div className="flex items-center justify-center border-l px-4 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                size="icon-lg"
                disabled={disabled}
                aria-label={downloadLabel}
                title={downloadLabel}
              />
            }
          >
            {submitting ? <LoaderCircle className="animate-spin" /> : <Download />}
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
      </div>
    </Card>
  )
}

function ReleaseQualityTags({ analysis }: { analysis: IndexerReleaseAnalysis }) {
  const { t } = useTranslation()
  const label =
    analysis.source.tier === 'excellent' || analysis.source.tier === 'good'
      ? t('recommendedRelease')
      : analysis.source.tier === 'poor'
        ? t('lowQualityRelease')
        : null
  const hasResolution = analysis.resolution.id !== 'other'
  const hasKnownSource = analysis.source.id !== 'unknown'
  const warningTooltip = getReleaseWarningTooltip(analysis, t)
  const sourceTooltip = joinTooltips([getReleaseSourceTooltip(analysis.source.id, t), warningTooltip])

  return (
    <>
      {label ? (
        <ReleaseTag
          className={cn('font-semibold', getQualityBadgeClassName(analysis.source.tier))}
          tooltip={getReleaseQualityTooltip(analysis.source.tier, t)}
        >
          {label}
        </ReleaseTag>
      ) : null}
      {hasResolution ? (
        <ReleaseTag
          className="border-sky-500/30 bg-sky-500/10 font-semibold text-sky-700 dark:text-sky-300"
          tooltip={getReleaseResolutionTooltip(analysis.resolution.id, t)}
        >
          {analysis.resolution.label}
        </ReleaseTag>
      ) : null}
      {hasKnownSource ? (
        <ReleaseTag className={getSourceBadgeClassName(analysis.source.tier)} tooltip={sourceTooltip}>
          {analysis.source.label}
        </ReleaseTag>
      ) : null}
    </>
  )
}

function ReleaseTag({
  children,
  className,
  tooltip,
}: {
  children: ReactNode
  className?: string
  tooltip?: string | null
}) {
  const badge = (
    <Badge variant="outline" className={className} tabIndex={tooltip ? 0 : undefined}>
      {children}
    </Badge>
  )

  if (!tooltip) return badge

  return (
    <Tooltip>
      <TooltipTrigger render={badge} />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

function ReleaseSpecTags({ analysis }: { analysis: IndexerReleaseAnalysis }) {
  const { t } = useTranslation()
  const markers = [
    analysis.codec ? { label: analysis.codec, tooltip: getCodecTooltip(analysis.codec, t) } : null,
    analysis.hdr ? { label: analysis.hdr, tooltip: getHdrTooltip(analysis.hdr, t) } : null,
    analysis.audio ? { label: analysis.audio, tooltip: getAudioTooltip(analysis.audio, t) } : null,
    ...analysis.subtitles.slice(0, 2).map((label) => ({ label, tooltip: getSubtitleTooltip(label, t) })),
    ...analysis.editions.slice(0, 2).map((label) => ({ label, tooltip: getEditionTooltip(label, t) })),
  ].filter((marker): marker is { label: string; tooltip: string } => Boolean(marker))

  if (markers.length === 0) return null

  return (
    <>
      {markers.slice(0, 6).map((marker) => (
        <ReleaseTag key={marker.label} className="bg-muted/40 text-foreground" tooltip={marker.tooltip}>
          {marker.label}
        </ReleaseTag>
      ))}
    </>
  )
}

function getQualityBadgeClassName(tier: ReleaseSourceTier) {
  if (tier === 'poor') return 'border-destructive/30 bg-destructive/10 text-destructive'
  if (tier === 'watchable') return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  if (tier === 'excellent' || tier === 'good')
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  return 'border-slate-400/30 bg-slate-500/10 text-slate-600 dark:text-slate-300'
}

function getSourceBadgeClassName(tier: ReleaseSourceTier) {
  if (tier === 'poor') return 'border-destructive/25 bg-destructive/5 text-destructive'
  if (tier === 'watchable') return 'border-orange-500/25 bg-orange-500/10 text-orange-700 dark:text-orange-300'
  if (tier === 'excellent' || tier === 'good')
    return 'border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300'
  return 'border-border bg-muted/50 text-muted-foreground'
}

function getReleaseWarningTooltip(analysis: IndexerReleaseAnalysis, t: TFunction) {
  if (analysis.warnings.length === 0) return null

  return analysis.warnings
    .map((warning) => t(warning === 'lowQualitySource' ? 'lowQualitySourceWarning' : 'screenerSourceWarning'))
    .join(' / ')
}

function joinTooltips(values: Array<string | null>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).join(' / ') || null
}

function getReleaseQualityTooltip(tier: ReleaseSourceTier, t: TFunction) {
  if (tier === 'excellent' || tier === 'good') return t('releaseQualityRecommendedTooltip')
  if (tier === 'watchable') return t('releaseQualityWatchableTooltip')
  if (tier === 'poor') return t('releaseQualityLowTooltip')
  return t('releaseQualityUnknownTooltip')
}

function getReleaseResolutionTooltip(id: IndexerReleaseAnalysis['resolution']['id'], t: TFunction) {
  if (id === '2160p') return t('releaseResolution2160pTooltip')
  if (id === '1080p') return t('releaseResolution1080pTooltip')
  if (id === '720p') return t('releaseResolution720pTooltip')
  if (id === '480p') return t('releaseResolution480pTooltip')
  if (id === '360p') return t('releaseResolution360pTooltip')
  return t('releaseResolutionOtherTooltip')
}

function getReleaseSourceTooltip(id: string, t: TFunction) {
  if (id === 'remux') return t('releaseSourceRemuxTooltip')
  if (id === 'bdmv') return t('releaseSourceBdmvTooltip')
  if (id === 'uhd-bluray') return t('releaseSourceUhdBlurayTooltip')
  if (id === 'bluray') return t('releaseSourceBlurayTooltip')
  if (id === 'dcprip') return t('releaseSourceDcpRipTooltip')
  if (id === 'webdl') return t('releaseSourceWebDlTooltip')
  if (id === 'webrip') return t('releaseSourceWebRipTooltip')
  if (id === 'hdtv') return t('releaseSourceHdtvTooltip')
  if (id === 'hdrip') return t('releaseSourceHdRipTooltip')
  if (id === 'dvdrip') return t('releaseSourceDvdRipTooltip')
  if (id === 'screener') return t('releaseSourceScreenerTooltip')
  if (id === 'r5') return t('releaseSourceR5Tooltip')
  if (id === 'telecine') return t('releaseSourceTelecineTooltip')
  if (id === 'telesync') return t('releaseSourceTelesyncTooltip')
  if (id === 'hdcam') return t('releaseSourceHdcamTooltip')
  if (id === 'cam') return t('releaseSourceCamTooltip')
  return t('releaseSourceUnknownTooltip')
}

function getCodecTooltip(label: string, t: TFunction) {
  if (label === 'AV1') return t('releaseCodecAv1Tooltip')
  if (label === 'x265') return t('releaseCodecX265Tooltip')
  if (label === 'x264') return t('releaseCodecX264Tooltip')
  if (label === 'VP9') return t('releaseCodecVp9Tooltip')
  if (label === 'MPEG-2') return t('releaseCodecMpeg2Tooltip')
  return t('releaseCodecTooltip')
}

function getHdrTooltip(label: string, t: TFunction) {
  if (label === 'Dolby Vision') return t('releaseHdrDolbyVisionTooltip')
  if (label === 'HDR10+') return t('releaseHdrHdr10PlusTooltip')
  if (label === 'HDR10') return t('releaseHdrHdr10Tooltip')
  if (label === 'HDR') return t('releaseHdrHdrTooltip')
  if (label === 'SDR') return t('releaseHdrSdrTooltip')
  return t('releaseHdrTooltip')
}

function getAudioTooltip(label: string, t: TFunction) {
  if (label === 'TrueHD Atmos') return t('releaseAudioTrueHdAtmosTooltip')
  if (label === 'Atmos') return t('releaseAudioAtmosTooltip')
  if (label === 'DTS-HD MA') return t('releaseAudioDtsHdMaTooltip')
  if (label === 'DTS') return t('releaseAudioDtsTooltip')
  if (label === 'EAC3') return t('releaseAudioEac3Tooltip')
  if (label === 'AC3') return t('releaseAudioAc3Tooltip')
  if (label === 'AAC') return t('releaseAudioAacTooltip')
  if (label === 'FLAC') return t('releaseAudioFlacTooltip')
  if (label === 'MP3') return t('releaseAudioMp3Tooltip')
  return t('releaseAudioTooltip')
}

function getSubtitleTooltip(label: string, t: TFunction) {
  if (label === 'Hardcoded subs') return t('releaseSubtitleHardcodedTooltip')
  if (label === 'CHS') return t('releaseSubtitleChsTooltip')
  if (label === 'CHT') return t('releaseSubtitleChtTooltip')
  if (label === 'ENG subs') return t('releaseSubtitleEngTooltip')
  if (label === 'MULTi subs') return t('releaseSubtitleMultiTooltip')
  return t('releaseSubtitleTooltip')
}

function getEditionTooltip(label: string, t: TFunction) {
  if (label === 'IMAX') return t('releaseEditionImaxTooltip')
  if (label === 'Extended') return t('releaseEditionExtendedTooltip')
  if (label === "Director's Cut") return t('releaseEditionDirectorsCutTooltip')
  if (label === 'Theatrical') return t('releaseEditionTheatricalTooltip')
  if (label === 'Unrated') return t('releaseEditionUnratedTooltip')
  if (label === 'Criterion') return t('releaseEditionCriterionTooltip')
  return t('releaseEditionTooltip')
}

function getMediaTags(media: ReleaseSearchMedia, item: IndexerSearchItem) {
  if (media.downloadTags) return media.downloadTags

  return [
    `tmdbId=${item.tmdbId ?? media.id}`,
    item.imdbId ? `imdbId=${item.imdbId}` : null,
    item.tvdbId ? `tvdbId=${item.tvdbId}` : null,
  ].filter((tag): tag is string => Boolean(tag))
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

function getReleaseIndexers(items: IndexerSearchItem[]) {
  return Array.from(new Set(items.map((item) => item.indexer))).sort((left, right) => left.localeCompare(right))
}

function sortReleases(items: IndexerSearchItem[], sort: ReleaseSort) {
  return [...items].sort((left, right) => {
    if (sort === 'best') {
      return compareIndexerReleasesByRecommendation(left, right)
    }

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
  sourceFilter,
  sort,
}: {
  items: IndexerSearchItem[]
  keyword: string
  indexer: string
  quality: ReleaseQuality
  sourceFilter: ReleaseSourceFilter
  sort: ReleaseSort
}) {
  const normalizedKeyword = keyword.trim().toLowerCase()
  const filtered = items.filter((item) => {
    const analysis = analyzeIndexerRelease(item)
    const matchesKeyword =
      normalizedKeyword.length === 0 ||
      item.title.toLowerCase().includes(normalizedKeyword) ||
      item.indexer.toLowerCase().includes(normalizedKeyword)
    const matchesIndexer = indexer === 'all' || item.indexer === indexer
    const matchesQuality = quality === 'all' || getReleaseQualityFromAnalysis(analysis) === quality
    const matchesSource = matchesReleaseSourceFilter(analysis.source.tier, sourceFilter)

    return matchesKeyword && matchesIndexer && matchesQuality && matchesSource
  })

  return sortReleases(filtered, sort)
}

function getReleaseQualityFromAnalysis(analysis: IndexerReleaseAnalysis): ReleaseQuality {
  const resolution = analysis.resolution.id
  if (resolution === '2160p' || resolution === '1080p' || resolution === '720p') return resolution
  return 'other'
}

function matchesReleaseSourceFilter(tier: ReleaseSourceTier, filter: ReleaseSourceFilter) {
  if (filter === 'all') return true
  if (filter === 'high') return tier === 'excellent' || tier === 'good'
  if (filter === 'watchable') return tier === 'watchable'
  if (filter === 'low') return tier === 'poor'
  return tier === 'unknown'
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
