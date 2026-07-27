import type { DownloadSearchTarget, MediaKind } from '@shared/types'
import { AlertTriangle, LoaderCircle, RefreshCw, SlidersHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useOutletContext, useParams } from 'react-router'
import type { AppOutletContext } from '@/components/app-shell/types'
import { ReleaseSearchSurface } from '@/components/release-search-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useReleaseSearchTasks } from '@/contexts/release-search-tasks'
import { useMediaDetails } from '@/hooks/use-media-queries'
import { useBookDetails } from '@/hooks/use-resource-queries'
import { getTmdbLanguage } from '@/i18n'
import {
  getBookReleaseSearchContext,
  getMediaReleaseSearchContext,
  type ReleaseSearchContext,
  type ReleaseSearchTaskRequest,
} from '@/lib/release-search-context'

interface ReleaseRouteState {
  origin?: string
}

export function MediaReleaseSearchPage({ kind }: { kind: MediaKind }) {
  const { id } = useParams()
  const { i18n, t } = useTranslation()
  const routeId = Number(id)
  const isValidRouteId = Number.isInteger(routeId) && routeId > 0
  const details = useMediaDetails(kind, isValidRouteId ? routeId : 0, getTmdbLanguage(i18n.language), 'US')
  const rawMedia = details.data ?? null
  const media = rawMedia?.id === routeId && rawMedia.kind === kind ? rawMedia : null
  const waitingForCurrentMedia = details.isFetching && Boolean(rawMedia) && !media
  const parentPath = isValidRouteId ? `/${kind === 'movie' ? 'movies' : 'series'}/${routeId}` : getMediaIndexPath(kind)
  const context = useMemo<ReleaseSearchContext | null>(() => {
    if (!media) return null
    return getMediaReleaseSearchContext(media)
  }, [media])

  return (
    <ReleaseSearchPageLayout
      context={context}
      contextLoading={details.isLoading || waitingForCurrentMedia}
      contextError={
        !isValidRouteId
          ? t('invalidMediaRoute')
          : details.error instanceof Error
            ? details.error.message
            : media
              ? null
              : waitingForCurrentMedia
                ? null
                : t('mediaNotFound')
      }
      fallbackPath={getMediaIndexPath(kind)}
      parentPath={parentPath}
      onContextRetry={() => void details.refetch()}
    />
  )
}

export function BookReleaseSearchPage() {
  const { key, target } = useParams()
  const mediaKey = key ?? ''
  const parsedTarget = getBookReleaseTarget(target)
  const details = useBookDetails(mediaKey, { enabled: Boolean(parsedTarget) })
  const rawBook = details.data ?? null
  const book = rawBook?.mediaKey === mediaKey ? rawBook : null
  const waitingForCurrentBook = details.isFetching && Boolean(rawBook) && !book
  const { t } = useTranslation()
  const parentPath = mediaKey ? `/books/${encodeURIComponent(mediaKey)}` : '/books'
  const context = useMemo<ReleaseSearchContext | null>(() => {
    if (!book || !parsedTarget) return null
    return getBookReleaseSearchContext(book, parsedTarget)
  }, [book, parsedTarget])

  return (
    <ReleaseSearchPageLayout
      context={context}
      contextLoading={details.isLoading || waitingForCurrentBook}
      contextError={
        !parsedTarget
          ? t('invalidReleaseSearchTarget')
          : details.error instanceof Error
            ? details.error.message
            : book || !mediaKey || waitingForCurrentBook
              ? null
              : t('mediaNotFound')
      }
      fallbackPath="/books"
      parentPath={parentPath}
      onContextRetry={() => void details.refetch()}
    />
  )
}

function ReleaseSearchPageLayout({
  context,
  contextLoading,
  contextError,
  fallbackPath,
  parentPath,
  onContextRetry,
}: {
  context: ReleaseSearchContext | null
  contextLoading: boolean
  contextError: string | null
  fallbackPath: string
  parentPath: string
  onContextRetry: () => void
}) {
  const { t } = useTranslation()
  const location = useLocation()
  const { setTopbarOverride } = useOutletContext<AppOutletContext>()
  const { tasks, startTask, markTaskRead } = useReleaseSearchTasks()
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const originPath = getOriginPath(location.state)
  const backTo = originPath ?? parentPath
  const task = context ? tasks.find((item) => item.id === context.fingerprint) : undefined
  const request = useMemo<ReleaseSearchTaskRequest | null>(
    () =>
      context
        ? {
            ...context,
            resultPath: location.pathname,
            originPath: originPath ?? undefined,
          }
        : null,
    [context, location.pathname, originPath],
  )
  const loading = task?.status === 'searching'

  useEffect(() => {
    setTopbarOverride({
      pathname: location.pathname,
      title: context?.media.title ?? t('indexerSearch'),
      subtitle: context ? getReleaseSearchPageSubtitle(context, t) : t('indexerSearchSubtitle'),
      backTo,
      backMode: originPath ? 'history' : 'replace',
      hideSearch: true,
      actions:
        context && !loading ? (
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            className="rounded-full md:hidden"
            onClick={() => setMobileFiltersOpen(true)}
            aria-label={t('filters')}
            title={t('filters')}
          >
            <SlidersHorizontal />
          </Button>
        ) : null,
    })

    return () => setTopbarOverride(null)
  }, [backTo, context, loading, location.pathname, originPath, setTopbarOverride, t])

  useEffect(() => {
    if (!request || task) return
    startTask(request, { announce: false })
  }, [request, startTask, task])

  useEffect(() => {
    if (!task || task.status === 'searching') return
    markTaskRead(task.id)
  }, [markTaskRead, task, task?.status, task?.unread])

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1520px] flex-col px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      {contextLoading ? (
        <ReleaseSearchPlaceholder>{t('searchingIndexers')}</ReleaseSearchPlaceholder>
      ) : contextError ? (
        <ReleaseSearchRouteError message={contextError} fallbackPath={fallbackPath} onRetry={onContextRetry} />
      ) : context && task && request ? (
        <ReleaseSearchSurface
          media={context.media}
          query={context.displayQuery}
          items={task.items}
          loading={task.status === 'searching'}
          canSearchMore={task.canSearchMore}
          error={task.error}
          progress={task.progress}
          onSearch={() => startTask(request)}
          onSearchMore={() => startTask(request, { exhaustive: true })}
          mobileFiltersOpen={mobileFiltersOpen}
          onMobileFiltersOpenChange={setMobileFiltersOpen}
        />
      ) : context ? (
        <ReleaseSearchPlaceholder>{t('searchingIndexers')}</ReleaseSearchPlaceholder>
      ) : (
        <ReleaseSearchRouteError message={t('indexerSearchMissingContext')} fallbackPath={fallbackPath} />
      )}
    </div>
  )
}

function ReleaseSearchPlaceholder({ children }: { children: ReactNode }) {
  return (
    <Card className="flex min-h-80 items-center justify-center p-6">
      <CardContent className="flex flex-col items-center gap-4 px-0 text-muted-foreground">
        <LoaderCircle className="size-8 animate-spin text-primary" />
        <div className="font-medium text-sm">{children}</div>
        <div className="grid w-full max-w-md gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </CardContent>
    </Card>
  )
}

function getReleaseSearchPageSubtitle(context: ReleaseSearchContext, t: (key: string) => string) {
  return [
    getReleaseSearchKindLabel(context, t),
    context.media.releaseYear,
    `${t('releaseSearchQuery')}: ${context.displayQuery}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' / ')
}

function getReleaseSearchKindLabel(context: ReleaseSearchContext, t: (key: string) => string) {
  if (context.mode === 'media') {
    return context.search.kind === 'movie' ? t('movie') : t('tv')
  }

  if (context.search.target === 'music') return t('music')
  if (context.search.target === 'ebook') return t('ebook')
  return t('audiobook')
}

function ReleaseSearchRouteError({
  message,
  fallbackPath,
  onRetry,
}: {
  message: string
  fallbackPath: string
  onRetry?: () => void
}) {
  const { t } = useTranslation()
  return (
    <Alert variant="destructive" className="min-h-64 items-start p-5">
      <AlertTriangle className="mt-0.5" />
      <AlertTitle>{t('searchUnavailable')}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      <div className="col-start-2 mt-4 flex flex-wrap gap-2">
        {onRetry ? (
          <Button type="button" variant="destructive" size="sm" onClick={onRetry}>
            <RefreshCw data-icon="inline-start" />
            {t('retrySearch')}
          </Button>
        ) : null}
        <Link to={fallbackPath} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {t('back')}
        </Link>
      </div>
    </Alert>
  )
}

function getOriginPath(state: unknown) {
  if (!state || typeof state !== 'object' || !('origin' in state)) return null
  const origin = (state as ReleaseRouteState).origin
  return typeof origin === 'string' && origin.startsWith('/') ? origin : null
}

function getMediaIndexPath(kind: MediaKind) {
  return kind === 'movie' ? '/movies' : '/series'
}

function getBookReleaseTarget(value: string | undefined): Extract<DownloadSearchTarget, 'ebook' | 'audiobook'> | null {
  if (value === 'ebook' || value === 'audiobook') return value
  return null
}
