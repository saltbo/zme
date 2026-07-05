import type { ReleaseMatchCriteria, ResourceDownloadSearchInput } from '@shared/indexer-search'
import type { DownloadSearchTarget, IndexerSearchItem, MediaKind } from '@shared/types'
import { AlertTriangle, LoaderCircle, RefreshCw, SlidersHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useOutletContext, useParams } from 'react-router'
import type { AppOutletContext } from '@/components/app-shell/types'
import {
  type ReleaseSearchError,
  type ReleaseSearchMedia,
  ReleaseSearchSurface,
} from '@/components/release-search-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useMediaDetails } from '@/hooks/use-media-queries'
import { useBookDetails, useMusicAlbumDetails } from '@/hooks/use-resource-queries'
import { getTmdbLanguage } from '@/i18n'
import { ApiError } from '@/lib/api'
import {
  type ReleaseSearchProgress,
  type ReleaseSearchProgressHandler,
  searchMediaReleasesInSteps,
  searchResourceReleasesInSteps,
} from '@/lib/release-search'
import {
  getBookReleaseSearchInput,
  getMediaReleaseSearchInput,
  getMusicReleaseSearchInput,
  type ResourceReleaseSearchInput,
} from '@/lib/release-search-context'

type ReleaseSearchContext =
  | {
      mode: 'media'
      media: ReleaseSearchMedia
      displayQuery: string
      search: ReleaseMatchCriteria
      fingerprint: string
    }
  | {
      mode: 'resource'
      media: ReleaseSearchMedia
      displayQuery: string
      search: ResourceDownloadSearchInput
      fingerprint: string
    }

interface ReleaseSearchRun {
  items: IndexerSearchItem[]
  progress: ReleaseSearchProgress | null
  loading: boolean
  error: ReleaseSearchError | null
  listeners: Set<() => void>
  promise: Promise<void>
}

interface ReleaseRouteState {
  origin?: string
}

const releaseSearchRuns = new Map<string, ReleaseSearchRun>()

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
    const search = getMediaReleaseSearchInput(media)
    return {
      mode: 'media',
      media,
      displayQuery: search.label,
      search,
      fingerprint: getSearchFingerprint('media', search, media),
    }
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

export function MusicReleaseSearchPage() {
  const { key } = useParams()
  const mediaKey = key ?? ''
  const details = useMusicAlbumDetails(mediaKey)
  const rawAlbum = details.data ?? null
  const album = rawAlbum?.mediaKey === mediaKey ? rawAlbum : null
  const waitingForCurrentAlbum = details.isFetching && Boolean(rawAlbum) && !album
  const { t } = useTranslation()
  const parentPath = mediaKey ? `/music/${encodeURIComponent(mediaKey)}` : '/music'
  const context = useMemo<ReleaseSearchContext | null>(() => {
    if (!album) return null
    const input = getMusicReleaseSearchInput(album)
    return getResourceSearchContext(input)
  }, [album])

  return (
    <ReleaseSearchPageLayout
      context={context}
      contextLoading={details.isLoading || waitingForCurrentAlbum}
      contextError={
        details.error instanceof Error
          ? details.error.message
          : album || !mediaKey || waitingForCurrentAlbum
            ? null
            : t('mediaNotFound')
      }
      fallbackPath="/music"
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
    const input = getBookReleaseSearchInput(book, parsedTarget)
    return getResourceSearchContext(input)
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
  const [retryNonce, setRetryNonce] = useState(0)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const backTo = getOriginPath(location.state) ?? parentPath
  const [searchState, setSearchState] = useState<{
    items: IndexerSearchItem[]
    progress: ReleaseSearchProgress | null
    loading: boolean
    error: ReleaseSearchError | null
  }>({ items: [], progress: null, loading: false, error: null })

  useEffect(() => {
    setTopbarOverride({
      pathname: location.pathname,
      title: t('indexerSearch'),
      subtitle: context?.media.title ?? t('indexerSearchSubtitle'),
      backTo,
      hideSearch: true,
      actions: context ? (
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
  }, [backTo, context, location.pathname, setTopbarOverride, t])

  useEffect(() => {
    if (!context) {
      setSearchState({ items: [], progress: null, loading: false, error: null })
      return
    }

    const run = getOrStartReleaseSearchRun(`${context.fingerprint}:${retryNonce}`, context, t)
    const sync = () => {
      setSearchState({
        items: run.items,
        progress: run.progress,
        loading: run.loading,
        error: run.error,
      })
    }

    run.listeners.add(sync)
    sync()
    return () => {
      run.listeners.delete(sync)
    }
  }, [context, retryNonce, t])

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1520px] flex-col px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <div className="h-[calc(100dvh-11rem)] min-h-[430px] md:h-[calc(100dvh-8rem)] md:min-h-[560px]">
        {contextLoading ? (
          <ReleaseSearchPlaceholder>{t('searchingIndexers')}</ReleaseSearchPlaceholder>
        ) : contextError ? (
          <ReleaseSearchRouteError message={contextError} fallbackPath={fallbackPath} onRetry={onContextRetry} />
        ) : context ? (
          <ReleaseSearchSurface
            media={context.media}
            query={context.displayQuery}
            items={searchState.items}
            loading={searchState.loading}
            error={searchState.error}
            progress={searchState.progress}
            onSearch={() => setRetryNonce((current) => current + 1)}
            mobileFiltersOpen={mobileFiltersOpen}
            onMobileFiltersOpenChange={setMobileFiltersOpen}
            showMobileFilterButton={false}
            className="h-full"
          />
        ) : (
          <ReleaseSearchRouteError message={t('indexerSearchMissingContext')} fallbackPath={fallbackPath} />
        )}
      </div>
    </div>
  )
}

function ReleaseSearchPlaceholder({ children }: { children: ReactNode }) {
  return (
    <Card className="flex h-full items-center justify-center p-6">
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

function getOrStartReleaseSearchRun(key: string, context: ReleaseSearchContext, t: (key: string) => string) {
  const existing = releaseSearchRuns.get(key)
  if (existing) return existing

  const run: ReleaseSearchRun = {
    items: [],
    progress: null,
    loading: true,
    error: null,
    listeners: new Set(),
    promise: Promise.resolve(),
  }
  const notify = () => {
    for (const listener of run.listeners) listener()
  }
  const onProgress: ReleaseSearchProgressHandler = (progress, results) => {
    run.progress = progress
    run.items = results
    notify()
  }

  run.promise = (
    context.mode === 'media'
      ? searchMediaReleasesInSteps(context.search, onProgress)
      : searchResourceReleasesInSteps(context.search, onProgress)
  )
    .then((results) => {
      run.items = results
      run.error = null
    })
    .catch((error) => {
      run.items = []
      run.error = getReleaseSearchError(error, t)
    })
    .finally(() => {
      run.loading = false
      run.progress = null
      notify()
    })

  releaseSearchRuns.set(key, run)
  return run
}

function getResourceSearchContext(input: ResourceReleaseSearchInput): ReleaseSearchContext {
  return {
    mode: 'resource',
    media: input.item,
    displayQuery: input.query,
    search: input,
    fingerprint: getSearchFingerprint('resource', input, input.item),
  }
}

function getSearchFingerprint(
  mode: ReleaseSearchContext['mode'],
  search: ReleaseMatchCriteria | ResourceDownloadSearchInput,
  media: ReleaseSearchMedia,
) {
  return JSON.stringify({
    mode,
    search,
    media: {
      id: media.id,
      kind: media.kind,
      title: media.title,
      year: media.releaseYear,
      category: media.downloadCategory,
      tags: media.downloadTags,
    },
  })
}

function getReleaseSearchError(error: unknown, t: (key: string) => string): ReleaseSearchError {
  if (error instanceof ApiError && (error.code === 'INDEXER_NOT_CONFIGURED' || error.status === 404)) {
    return {
      title: t('indexerNotConfiguredTitle'),
      description: t('indexerNotConfiguredDescription'),
      action: t('retrySearch'),
      tone: 'configuration',
    }
  }

  if (error instanceof ApiError && error.status === 502) {
    return {
      title: t('indexerConnectionFailedTitle'),
      description: t('indexerConnectionFailedDescription'),
      action: t('retrySearch'),
      tone: 'connection',
    }
  }

  return {
    title: t('indexerSearchFailedTitle'),
    description: error instanceof Error ? error.message : t('indexerSearchFailedDescription'),
    action: t('retrySearch'),
    tone: 'generic',
  }
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
