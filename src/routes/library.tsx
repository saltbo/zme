import type { LibraryFilterKind, LibraryFilterStatus } from '@shared/types'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { MediaWall } from '@/components/media/media-components'
import { Card } from '@/components/ui/card'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useLibrary } from '@/contexts/library'
import { getTmdbLanguage } from '@/i18n'
import { listLibrary } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { LibraryResourceCard } from '@/routes/resource-pages'

const PAGE_SIZE = 36

export function LibraryPage() {
  const { i18n, t } = useTranslation()
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const { items: libraryStates } = useLibrary()
  const kind = getKindParam(searchParams.get('kind'))
  const status = getStatusParam(searchParams.get('status'))
  const isResourceFilter = kind === 'music' || kind === 'book'
  const resourceItems = isResourceFilter
    ? libraryStates.filter((item) => item.savedAt && item.kind === kind && status !== 'watched')
    : []
  const input = { pageSize: PAGE_SIZE, language: getTmdbLanguage(i18n.language), kind, status }
  const library = useInfiniteQuery({
    queryKey: queryKeys.library.infinite(input),
    queryFn: async ({ pageParam }) => listLibrary({ ...input, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined),
    enabled: !isResourceFilter,
  })
  const items = library.data?.pages.flatMap((page) => page.items) ?? []
  const totalResults = isResourceFilter ? resourceItems.length : (library.data?.pages[0]?.totalResults ?? 0)
  const loading = !isResourceFilter && library.isLoading

  useEffect(() => {
    const target = loadMoreRef.current
    if (!target || !library.hasNextPage) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !library.isFetchingNextPage) {
          void library.fetchNextPage()
        }
      },
      { rootMargin: '480px 0px' },
    )

    observer.observe(target)
    return () => observer.disconnect()
  }, [library.fetchNextPage, library.hasNextPage, library.isFetchingNextPage])

  useEffect(() => {
    if (searchParams.has('page')) {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current)
          next.delete('page')
          return next
        },
        { replace: true },
      )
    }
  }, [searchParams, setSearchParams])

  function updateKind(value: LibraryFilterKind) {
    updateLibraryParams(setSearchParams, { kind: value, status })
  }

  function updateStatus(value: LibraryFilterStatus) {
    updateLibraryParams(setSearchParams, { kind, status: value })
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1680px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <div className="mb-5 flex flex-col gap-3 border-b pb-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <div className="font-semibold text-sm text-muted-foreground">{t('myLibrary')}</div>
          <div className="mt-1 text-muted-foreground text-sm">{t('libraryResultCount', { count: totalResults })}</div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 md:w-[420px]">
          <div className="min-w-0">
            <span className="mb-1 block font-medium text-muted-foreground text-xs">{t('type')}</span>
            <Select
              items={getKindOptions(t)}
              value={kind}
              onValueChange={(value) => updateKind((value || 'all') as LibraryFilterKind)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>
                <SelectGroup>
                  {getKindOptions(t).map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0">
            <span className="mb-1 block font-medium text-muted-foreground text-xs">{t('status')}</span>
            <Select
              items={getStatusOptions(t)}
              value={status}
              onValueChange={(value) => updateStatus((value || 'all') as LibraryFilterStatus)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>
                <SelectGroup>
                  {getStatusOptions(t).map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      {loading ? <MediaWall items={[]} loading /> : null}
      {!isResourceFilter && !loading && items.length > 0 ? <MediaWall items={items} loading={false} /> : null}
      {isResourceFilter && resourceItems.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-4 sm:gap-y-7 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
          {resourceItems.map((item) => (
            <LibraryResourceCard key={item.mediaKey} kind={kind} mediaKey={item.mediaKey} />
          ))}
        </div>
      ) : null}
      {!loading && totalResults === 0 ? (
        <Card className="flex min-h-80 items-center justify-center p-8 text-center text-muted-foreground">
          {t('noLibrary')}
        </Card>
      ) : null}
      {!loading && totalResults > 0 ? (
        <div ref={loadMoreRef} className="mt-8 flex min-h-10 items-center justify-center text-muted-foreground text-sm">
          {library.isFetchingNextPage
            ? t('loadingMore')
            : library.hasNextPage
              ? t('scrollToLoadMore')
              : t('noMoreMedia')}
        </div>
      ) : null}
    </div>
  )
}

function getKindParam(value: string | null): LibraryFilterKind {
  return value === 'movie' || value === 'tv' || value === 'music' || value === 'book' ? value : 'all'
}

function getStatusParam(value: string | null): LibraryFilterStatus {
  return value === 'unwatched' || value === 'watched' ? value : 'all'
}

function updateLibraryParams(
  setSearchParams: ReturnType<typeof useSearchParams>[1],
  input: { kind: LibraryFilterKind; status: LibraryFilterStatus },
) {
  const next = new URLSearchParams()
  if (input.kind !== 'all') next.set('kind', input.kind)
  if (input.status !== 'all') next.set('status', input.status)
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
    { label: t('unwatched'), value: 'unwatched' },
    { label: t('watched'), value: 'watched' },
  ]
}
