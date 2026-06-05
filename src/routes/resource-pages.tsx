import type {
  BookDetails,
  BookDiscoveryInput,
  BookDiscoveryMode,
  BookSearchItem,
  BookTrendingPeriod,
  DownloadSearchTarget,
  IndexerSearchItem,
  LibraryKind,
  LibraryResourceInput,
  MusicAlbumDetails,
  MusicAlbumSearchItem,
  MusicChartType,
  MusicDiscoveryInput,
  MusicDiscoveryMode,
  MusicDiscoveryRange,
  MusicGenre,
  MusicReleaseType,
} from '@shared/types'
import { useMutation } from '@tanstack/react-query'
import {
  BookOpen,
  CalendarDays,
  Check,
  ChevronsUpDown,
  CircleCheck,
  Disc3,
  Heart,
  Languages,
  ListMusic,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import type { MouseEvent, ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useOutletContext, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import type { AppOutletContext } from '@/components/app-shell/types'
import {
  ReleaseSearchDialog,
  type ReleaseSearchError,
  type ReleaseSearchMedia,
} from '@/components/release-search-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { type MediaStatus, useLibrary } from '@/contexts/library'
import { useBookDetails, useBookSearch, useMusicAlbumDetails, useMusicSearch } from '@/hooks/use-resource-queries'
import { ApiError, searchIndexers } from '@/lib/api'
import {
  compareResourceTitle,
  getResourceSearchSort,
  getResourceSearchSortOptions,
  parseResourceYear,
  type ResourceSearchSort,
} from '@/lib/resource-search-sort'
import { cn } from '@/lib/utils'

type ResourceKind = Extract<LibraryKind, 'music' | 'book'>

const resourceSkeletonKeys = [
  'resource-skeleton-1',
  'resource-skeleton-2',
  'resource-skeleton-3',
  'resource-skeleton-4',
  'resource-skeleton-5',
  'resource-skeleton-6',
]

const RESOURCE_PAGE_SIZE = 30
const currentYear = new Date().getFullYear()
const musicYearOptions = Array.from({ length: currentYear - 1949 }, (_, index) => String(currentYear - index))

const bookSubjectOptions = ['fiction', 'fantasy', 'romance', 'science_fiction', 'business', 'history', 'biography']
const musicGenreOptions: MusicGenre[] = ['rock', 'jazz', 'electronic', 'hip-hop', 'classical', 'pop', 'metal']

export function MusicPage() {
  const { t } = useTranslation()
  const location = useLocation()
  const { setTopbarOverride } = useOutletContext<AppOutletContext>()
  const [searchParams, setSearchParams] = useSearchParams()
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const query = searchParams.get('q')?.trim() ?? ''
  const mode = getMusicModeParam(searchParams.get('mode'))
  const range = getMusicRangeParam(searchParams.get('range'))
  const chartType = getMusicChartTypeParam(searchParams.get('chart'))
  const genre = getMusicGenreParam(searchParams.get('genre'))
  const releaseType = getMusicReleaseTypeParam(searchParams.get('type'))
  const year = getYearParam(searchParams.get('year'))
  const sort = getResourceSearchSort(searchParams.get('sort'))
  const discovery = useMemo(
    () => ({ mode, range, chartType, genre, releaseType, year, pageSize: RESOURCE_PAGE_SIZE }),
    [chartType, genre, mode, range, releaseType, year],
  )
  const openFilters = useCallback(() => setMobileFiltersOpen(true), [])
  const search = useMusicSearch(query, discovery)
  const rawItems = search.data?.pages.flatMap((page) => page.results) ?? []
  const items = query ? sortMusicSearchResults(rawItems, sort) : rawItems

  useEffect(() => {
    if (search.error) toast.error(search.error instanceof Error ? search.error.message : t('searchFailed'))
  }, [search.error, t])

  useResourceTopbar({
    pathname: location.pathname,
    setTopbarOverride,
    title: t('music'),
    subtitle: t('musicSubtitle'),
    onOpenFilters: openFilters,
    showFilters: !query,
    t,
  })

  useInfiniteResourceLoader(loadMoreRef, search.hasNextPage, search.isFetchingNextPage, search.fetchNextPage)

  function updateMusicDiscovery(nextInput: Partial<Omit<typeof discovery, 'pageSize'>>) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      const nextMode = nextInput.mode ?? mode
      const nextRange = nextInput.range ?? range
      const nextChartType = nextInput.chartType ?? chartType
      const nextGenre = nextInput.genre ?? genre
      const nextReleaseType = nextInput.releaseType ?? releaseType
      const nextYear = nextInput.year ?? year
      if (nextMode === 'popular') next.delete('mode')
      else next.set('mode', nextMode)
      if (nextRange === 'all_time') next.delete('range')
      else next.set('range', nextRange)
      if (nextChartType === 'albums') next.delete('chart')
      else next.set('chart', nextChartType)
      if (nextGenre) next.set('genre', nextGenre)
      else next.delete('genre')
      if (nextReleaseType === 'album') next.delete('type')
      else next.set('type', nextReleaseType)
      if (nextYear) next.set('year', nextYear)
      else next.delete('year')
      return next
    })
  }

  return (
    <ResourceSearchPage
      emptyTitle={t('searchMusic')}
      emptyDescription={t('searchMusicDescription')}
      query={query}
      loading={search.isLoading}
      loadingMore={search.isFetchingNextPage}
      hasNextPage={search.hasNextPage}
      loadMoreRef={loadMoreRef}
      items={items.map((item) => ({ key: item.mediaKey, node: <MusicAlbumCard item={item} /> }))}
      filters={
        query ? (
          <ResourceSearchSortBar
            value={sort}
            onChange={(value) => updateSearchParam(setSearchParams, 'sort', value === 'best' ? undefined : value)}
          />
        ) : (
          <MusicFilterBar
            mode={mode}
            range={range}
            chartType={chartType}
            genre={genre}
            releaseType={releaseType}
            year={year}
            mobileOpen={mobileFiltersOpen}
            onMobileOpenChange={setMobileFiltersOpen}
            onChange={updateMusicDiscovery}
          />
        )
      }
    />
  )
}

export function BooksPage() {
  const { t } = useTranslation()
  const location = useLocation()
  const { setTopbarOverride } = useOutletContext<AppOutletContext>()
  const [searchParams, setSearchParams] = useSearchParams()
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const query = searchParams.get('q')?.trim() ?? ''
  const mode = getBookModeParam(searchParams.get('mode'))
  const period = getBookPeriodParam(searchParams.get('period'))
  const subject = getBookSubjectParam(searchParams.get('subject'))
  const sort = getResourceSearchSort(searchParams.get('sort'))
  const discovery = useMemo(() => ({ mode, period, subject, pageSize: RESOURCE_PAGE_SIZE }), [mode, period, subject])
  const openFilters = useCallback(() => setMobileFiltersOpen(true), [])
  const search = useBookSearch(query, discovery)
  const rawItems = search.data?.pages.flatMap((page) => page.results) ?? []
  const items = query ? sortBookSearchResults(rawItems, sort) : rawItems

  useEffect(() => {
    if (search.error) toast.error(search.error instanceof Error ? search.error.message : t('searchFailed'))
  }, [search.error, t])

  useResourceTopbar({
    pathname: location.pathname,
    setTopbarOverride,
    title: t('books'),
    subtitle: t('booksSubtitle'),
    onOpenFilters: openFilters,
    showFilters: !query,
    t,
  })

  useInfiniteResourceLoader(loadMoreRef, search.hasNextPage, search.isFetchingNextPage, search.fetchNextPage)

  function updateDiscovery(nextInput: Partial<Omit<BookDiscoveryInput, 'page' | 'pageSize'>>) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      const nextMode = nextInput.mode ?? mode
      const nextPeriod = nextInput.period ?? period
      const nextSubject = nextInput.subject ?? subject
      if (nextMode === 'trending') next.delete('mode')
      else next.set('mode', nextMode)
      if (nextPeriod === 'daily') next.delete('period')
      else next.set('period', nextPeriod)
      if (nextSubject) next.set('subject', nextSubject)
      else next.delete('subject')
      return next
    })
  }

  return (
    <ResourceSearchPage
      emptyTitle={t('searchBooks')}
      emptyDescription={t('searchBooksDescription')}
      query={query}
      loading={search.isLoading}
      loadingMore={search.isFetchingNextPage}
      hasNextPage={search.hasNextPage}
      loadMoreRef={loadMoreRef}
      items={items.map((item) => ({ key: item.mediaKey, node: <BookCard item={item} /> }))}
      filters={
        query ? (
          <ResourceSearchSortBar
            value={sort}
            onChange={(value) => updateSearchParam(setSearchParams, 'sort', value === 'best' ? undefined : value)}
          />
        ) : (
          <BookFilterBar
            mode={mode}
            period={period}
            subject={subject}
            mobileOpen={mobileFiltersOpen}
            onMobileOpenChange={setMobileFiltersOpen}
            onChange={updateDiscovery}
          />
        )
      }
    />
  )
}

function ResourceSearchSortBar({
  value,
  onChange,
}: {
  value: ResourceSearchSort
  onChange: (value: ResourceSearchSort) => void
}) {
  const { t } = useTranslation()
  const sortOptions = getResourceSearchSortOptions(t)

  return (
    <div className="mb-5 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
      <Badge variant="secondary" className="h-8 rounded-full px-3 font-semibold">
        {t('searchResults')}
      </Badge>
      <div className="min-w-0 sm:w-48">
        <span className="mb-1 block font-medium text-muted-foreground text-xs">{t('sort')}</span>
        <Select
          items={sortOptions}
          value={value}
          onValueChange={(nextValue) => onChange(getResourceSearchSort(nextValue))}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false}>
            <SelectGroup>
              {sortOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function updateSearchParam(
  setSearchParams: ReturnType<typeof useSearchParams>[1],
  key: string,
  value: string | undefined,
) {
  setSearchParams((current) => {
    const next = new URLSearchParams(current)
    if (value) next.set(key, value)
    else next.delete(key)
    return next
  })
}

function sortMusicSearchResults(items: MusicAlbumSearchItem[], sort: ResourceSearchSort) {
  if (sort === 'best') return items

  return [...items].sort((left, right) => {
    if (sort === 'title') return compareResourceTitle(left.title, right.title)

    const leftYear = parseResourceYear(left.releaseYear)
    const rightYear = parseResourceYear(right.releaseYear)
    const yearComparison = sort === 'newest' ? rightYear - leftYear : leftYear - rightYear
    return yearComparison || compareResourceTitle(left.title, right.title)
  })
}

function sortBookSearchResults(items: BookSearchItem[], sort: ResourceSearchSort) {
  if (sort === 'best') return items

  return [...items].sort((left, right) => {
    if (sort === 'title') return compareResourceTitle(left.title, right.title)

    const leftYear = left.firstPublishYear ?? 0
    const rightYear = right.firstPublishYear ?? 0
    const yearComparison = sort === 'newest' ? rightYear - leftYear : leftYear - rightYear
    return yearComparison || compareResourceTitle(left.title, right.title)
  })
}

function ResourceSearchPage({
  emptyTitle,
  emptyDescription,
  query,
  loading,
  loadingMore,
  hasNextPage,
  loadMoreRef,
  items,
  filters,
}: {
  emptyTitle: string
  emptyDescription: string
  query: string
  loading: boolean
  loadingMore: boolean
  hasNextPage: boolean
  loadMoreRef: RefObject<HTMLDivElement | null>
  items: { key: string; node: ReactNode }[]
  filters: ReactNode
}) {
  const { t } = useTranslation()

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1680px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      {filters}

      {!query && !loading && items.length === 0 ? (
        <Card className="flex min-h-80 items-center justify-center p-8 text-center">
          <CardContent className="max-w-md px-0">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Search className="size-5" />
            </div>
            <h2 className="mt-4 font-semibold">{emptyTitle}</h2>
            <p className="mt-2 text-muted-foreground text-sm">{emptyDescription}</p>
          </CardContent>
        </Card>
      ) : null}

      {loading ? <ResourceGridSkeleton /> : null}
      {query && !loading && items.length === 0 ? (
        <Card className="flex min-h-80 items-center justify-center p-8 text-muted-foreground">
          {t('noMatchedMedia')}
        </Card>
      ) : null}
      {!loading && items.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-4 sm:gap-y-7 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
          {items.map((item) => (
            <div key={item.key}>{item.node}</div>
          ))}
        </div>
      ) : null}
      {!query || items.length > 0 ? (
        <div ref={loadMoreRef} className="mt-8 flex min-h-10 items-center justify-center text-muted-foreground text-sm">
          {loadingMore ? t('loadingMore') : hasNextPage ? t('scrollToLoadMore') : t('noMoreMedia')}
        </div>
      ) : null}
    </div>
  )
}

function MusicFilterBar({
  mode,
  range,
  chartType,
  genre,
  releaseType,
  year,
  mobileOpen,
  onMobileOpenChange,
  onChange,
}: {
  mode: MusicDiscoveryMode
  range: MusicDiscoveryRange
  chartType: MusicChartType
  genre?: MusicGenre
  releaseType: MusicReleaseType
  year: string
  mobileOpen: boolean
  onMobileOpenChange: (open: boolean) => void
  onChange: (next: Partial<Omit<MusicDiscoveryInput, 'page' | 'pageSize'>>) => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <div className="mb-5 hidden border-b pb-4 md:block">
        <MusicFilterControls
          mode={mode}
          range={range}
          chartType={chartType}
          genre={genre}
          releaseType={releaseType}
          year={year}
          onChange={onChange}
        />
      </div>
      <ResourceFilterSheet title={t('filters')} open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <MusicFilterControls
          mode={mode}
          range={range}
          chartType={chartType}
          genre={genre}
          releaseType={releaseType}
          year={year}
          onChange={onChange}
        />
      </ResourceFilterSheet>
    </>
  )
}

function MusicFilterControls({
  mode,
  range,
  chartType,
  genre,
  releaseType,
  year,
  onChange,
}: {
  mode: MusicDiscoveryMode
  range: MusicDiscoveryRange
  chartType: MusicChartType
  genre?: MusicGenre
  releaseType: MusicReleaseType
  year: string
  onChange: (next: Partial<Omit<MusicDiscoveryInput, 'page' | 'pageSize'>>) => void
}) {
  const { t } = useTranslation()
  const yearInputId = useId()
  const modeOptions: Array<{ value: MusicDiscoveryMode; label: string }> = useMemo(
    () => [
      { value: 'popular', label: t('popular') },
      { value: 'genre', label: t('genreBrowse') },
    ],
    [t],
  )
  const rangeOptions: Array<{ value: MusicDiscoveryRange; label: string }> = useMemo(
    () => [
      { value: 'all_time', label: t('allTime') },
      { value: 'year', label: t('thisYear') },
      { value: 'month', label: t('thisMonth') },
      { value: 'week', label: t('thisWeek') },
    ],
    [t],
  )
  const chartOptions: Array<{ value: MusicChartType; label: string }> = useMemo(
    () => [
      { value: 'albums', label: t('albums') },
      { value: 'tracks', label: t('tracks') },
    ],
    [t],
  )
  const genreOptions = useMemo(
    () => musicGenreOptions.map((value) => ({ value, label: t(`musicGenre.${value}`) })),
    [t],
  )
  const releaseTypeOptions: Array<{ value: MusicReleaseType; label: string }> = useMemo(
    () => [
      { value: 'album', label: t('album') },
      { value: 'ep', label: 'EP' },
      { value: 'single', label: t('single') },
    ],
    [t],
  )
  return (
    <div className="grid gap-2 md:grid-cols-4">
      <div className="min-w-0">
        <span className="mb-1 block font-medium text-muted-foreground text-xs">{t('source')}</span>
        <Select
          items={modeOptions}
          value={mode}
          onValueChange={(value) => onChange({ mode: value as MusicDiscoveryMode })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false}>
            <SelectGroup>
              {modeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      {mode === 'popular' ? (
        <>
          <div className="min-w-0">
            <span className="mb-1 block font-medium text-muted-foreground text-xs">{t('range')}</span>
            <Select
              items={rangeOptions}
              value={range}
              onValueChange={(value) => onChange({ range: (value || 'all_time') as MusicDiscoveryRange })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>
                <SelectGroup>
                  {rangeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0">
            <span className="mb-1 block font-medium text-muted-foreground text-xs">{t('chart')}</span>
            <Select
              items={chartOptions}
              value={chartType}
              onValueChange={(value) => onChange({ chartType: (value || 'albums') as MusicChartType })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>
                <SelectGroup>
                  {chartOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </>
      ) : (
        <>
          <div className="min-w-0">
            <span className="mb-1 block font-medium text-muted-foreground text-xs">{t('genre')}</span>
            <Select
              items={genreOptions}
              value={genre ?? 'rock'}
              onValueChange={(value) => onChange({ mode: 'genre', genre: (value || 'rock') as MusicGenre })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>
                <SelectGroup>
                  {genreOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0">
            <span className="mb-1 block font-medium text-muted-foreground text-xs">{t('releaseType')}</span>
            <Select
              items={releaseTypeOptions}
              value={releaseType}
              onValueChange={(value) => onChange({ releaseType: (value || 'album') as MusicReleaseType })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>
                <SelectGroup>
                  {releaseTypeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0">
            <label htmlFor={yearInputId} className="mb-1 block font-medium text-muted-foreground text-xs">
              {t('year')}
            </label>
            <MusicYearPicker inputId={yearInputId} year={year} onChange={(nextYear) => onChange({ year: nextYear })} />
          </div>
        </>
      )}
    </div>
  )
}

function MusicYearPicker({
  inputId,
  year,
  onChange,
}: {
  inputId: string
  year: string
  onChange: (year: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(year)
  const [filtering, setFiltering] = useState(false)
  const filteredYears = useMemo(() => {
    if (!filtering || !draft) return musicYearOptions
    return musicYearOptions.filter((option) => option.startsWith(draft))
  }, [draft, filtering])

  useEffect(() => {
    setDraft(year)
  }, [year])

  function updateYear(value: string) {
    const nextYear = value.replace(/\D/g, '').slice(0, 4)
    setDraft(nextYear)
    setFiltering(true)
    onChange(nextYear)
  }

  function openYearList() {
    setFiltering(false)
    setOpen(true)
  }

  const selectYear = useCallback(
    (nextYear: string) => {
      setDraft(nextYear)
      setFiltering(false)
      onChange(nextYear)
      setOpen(false)
    },
    [onChange],
  )

  return (
    <div className="relative">
      <div
        className={cn(
          'relative flex h-8 w-full min-w-0 items-center rounded-lg border border-input bg-transparent text-sm transition-colors outline-none focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
        )}
      >
        <input
          id={inputId}
          role="combobox"
          aria-autocomplete="list"
          aria-controls={`${inputId}-listbox`}
          aria-expanded={open}
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder={String(currentYear)}
          value={draft}
          onFocus={openYearList}
          onClick={openYearList}
          onChange={(event) => updateYear(event.target.value)}
          className="h-full min-w-0 flex-1 bg-transparent px-2.5 py-1 pr-8 outline-none placeholder:text-muted-foreground"
        />
        <ChevronsUpDown className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-2 size-4 text-muted-foreground" />
      </div>
      {open ? (
        <div
          id={`${inputId}-listbox`}
          role="listbox"
          className="absolute top-full right-0 left-0 z-50 mt-1 max-h-64 overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground text-sm shadow-md ring-1 ring-foreground/10"
        >
          {filteredYears.length > 0 ? (
            filteredYears.map((option) => (
              <MusicYearOption key={option} option={option} selected={option === year} onSelect={selectYear} />
            ))
          ) : (
            <div className="px-2.5 py-2 text-muted-foreground">No years</div>
          )}
        </div>
      ) : null}
    </div>
  )
}

function MusicYearOption({
  option,
  selected,
  onSelect,
}: {
  option: string
  selected: boolean
  onSelect: (option: string) => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onMouseDown={(event) => {
        event.preventDefault()
        onSelect(option)
      }}
      className="flex h-8 w-full cursor-default items-center justify-between rounded-md px-2.5 text-left outline-none hover:bg-muted aria-selected:bg-muted"
    >
      {option}
      {selected ? <Check /> : null}
    </button>
  )
}

function BookFilterBar({
  mode,
  period,
  subject,
  mobileOpen,
  onMobileOpenChange,
  onChange,
}: {
  mode: BookDiscoveryMode
  period: BookTrendingPeriod
  subject?: string
  mobileOpen: boolean
  onMobileOpenChange: (open: boolean) => void
  onChange: (next: Partial<Omit<BookDiscoveryInput, 'page' | 'pageSize'>>) => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <div className="mb-5 hidden border-b pb-4 md:block">
        <BookFilterControls mode={mode} period={period} subject={subject} onChange={onChange} />
      </div>
      <ResourceFilterSheet title={t('filters')} open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <BookFilterControls mode={mode} period={period} subject={subject} onChange={onChange} />
      </ResourceFilterSheet>
    </>
  )
}

function BookFilterControls({
  mode,
  period,
  subject,
  onChange,
}: {
  mode: BookDiscoveryMode
  period: BookTrendingPeriod
  subject?: string
  onChange: (next: Partial<Omit<BookDiscoveryInput, 'page' | 'pageSize'>>) => void
}) {
  const { t } = useTranslation()
  const modeOptions: Array<{ value: BookDiscoveryMode; label: string }> = useMemo(
    () => [
      { value: 'trending', label: t('trending') },
      { value: 'subject', label: t('subject') },
    ],
    [t],
  )
  const periodOptions: Array<{ value: BookTrendingPeriod; label: string }> = useMemo(
    () => [
      { value: 'daily', label: t('daily') },
      { value: 'weekly', label: t('weekly') },
      { value: 'monthly', label: t('monthly') },
      { value: 'yearly', label: t('yearly') },
    ],
    [t],
  )
  const subjectOptions = useMemo(
    () => bookSubjectOptions.map((value) => ({ value, label: t(`bookSubject.${value}`) })),
    [t],
  )
  return (
    <div className="grid gap-2 md:grid-cols-3">
      <div className="min-w-0">
        <span className="mb-1 block font-medium text-muted-foreground text-xs">{t('source')}</span>
        <Select
          items={modeOptions}
          value={mode}
          onValueChange={(value) => onChange({ mode: value as BookDiscoveryMode })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false}>
            <SelectGroup>
              {modeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-0">
        <span className="mb-1 block font-medium text-muted-foreground text-xs">{t('period')}</span>
        <Select
          items={periodOptions}
          value={period}
          onValueChange={(value) => onChange({ period: value as BookTrendingPeriod })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false}>
            <SelectGroup>
              {periodOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-0">
        <span className="mb-1 block font-medium text-muted-foreground text-xs">{t('subject')}</span>
        <Select
          items={subjectOptions}
          value={subject ?? 'fiction'}
          onValueChange={(value) => onChange({ mode: 'subject', subject: value || 'fiction' })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false}>
            <SelectGroup>
              {subjectOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function ResourceFilterSheet({
  title,
  open,
  onOpenChange,
  children,
}: {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[86dvh] overflow-y-auto rounded-t-xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{title}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">{children}</div>
      </SheetContent>
    </Sheet>
  )
}

function useResourceTopbar({
  pathname,
  setTopbarOverride,
  title,
  subtitle,
  showFilters,
  onOpenFilters,
  t,
}: {
  pathname: string
  setTopbarOverride: AppOutletContext['setTopbarOverride']
  title: string
  subtitle: string
  showFilters: boolean
  onOpenFilters: () => void
  t: (key: string) => string
}) {
  useEffect(() => {
    setTopbarOverride({
      pathname,
      title,
      subtitle,
      actions: showFilters ? (
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          className="rounded-full md:hidden"
          onClick={onOpenFilters}
          aria-label={t('filters')}
          title={t('filters')}
        >
          <SlidersHorizontal />
        </Button>
      ) : null,
    })
    return () => setTopbarOverride(null)
  }, [onOpenFilters, pathname, setTopbarOverride, showFilters, subtitle, t, title])
}

function useInfiniteResourceLoader(
  loadMoreRef: RefObject<HTMLDivElement | null>,
  hasNextPage: boolean,
  isFetchingNextPage: boolean,
  fetchNextPage: () => Promise<unknown>,
) {
  useEffect(() => {
    const target = loadMoreRef.current
    if (!target || !hasNextPage) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !isFetchingNextPage) {
          void fetchNextPage()
        }
      },
      { rootMargin: '480px 0px' },
    )

    observer.observe(target)
    return () => observer.disconnect()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, loadMoreRef])
}

function getMusicRangeParam(value: string | null): MusicDiscoveryRange {
  if (value === 'week' || value === 'month' || value === 'year') return value
  return 'all_time'
}

function getMusicModeParam(value: string | null): MusicDiscoveryMode {
  if (value === 'genre') return 'genre'
  return 'popular'
}

function getMusicChartTypeParam(value: string | null): MusicChartType {
  if (value === 'tracks') return 'tracks'
  return 'albums'
}

function getMusicGenreParam(value: string | null): MusicGenre | undefined {
  if (!value) return undefined
  return musicGenreOptions.includes(value as MusicGenre) ? (value as MusicGenre) : undefined
}

function getMusicReleaseTypeParam(value: string | null): MusicReleaseType {
  if (value === 'ep' || value === 'single') return value
  return 'album'
}

function getYearParam(value: string | null): string {
  if (!value) return ''
  return /^\d{1,4}$/.test(value) ? value : ''
}

function getBookModeParam(value: string | null): BookDiscoveryMode {
  if (value === 'subject') return 'subject'
  return 'trending'
}

function getBookPeriodParam(value: string | null): BookTrendingPeriod {
  if (value === 'weekly' || value === 'monthly' || value === 'yearly') return value
  return 'daily'
}

function getBookSubjectParam(value: string | null): string | undefined {
  if (!value) return undefined
  return bookSubjectOptions.includes(value) ? value : undefined
}

export function MusicDetailPage() {
  const location = useLocation()
  const { key } = useParams()
  const { setTopbarOverride } = useOutletContext<AppOutletContext>()
  const { t } = useTranslation()
  const mediaKey = key ?? ''
  const details = useMusicAlbumDetails(mediaKey)
  const album = details.data ?? null
  const [releaseDialog, setReleaseDialog] = useState<ReleaseDialogState | null>(null)
  const releaseSearch = useResourceReleaseSearch(setReleaseDialog)

  useEffect(() => {
    if (!album) return
    setTopbarOverride({
      pathname: location.pathname,
      title: album.title,
      subtitle: `${t('music')} / ${album.artist ?? album.releaseYear ?? t('unknown')}`,
    })
    return () => setTopbarOverride(null)
  }, [album, location.pathname, setTopbarOverride, t])

  function openReleaseSearch() {
    if (!album) return
    openResourceReleaseSearch({
      input: getMusicReleaseSearchInput(album),
      label: t('musicDownload'),
      releaseSearch,
      setReleaseDialog,
    })
  }

  if (details.isLoading) return <ResourceDetailSkeleton />
  if (!album)
    return <ResourceDetailError message={details.error instanceof Error ? details.error.message : t('mediaNotFound')} />

  const statusInput = { kind: 'music' as const, mediaKey: album.mediaKey }
  return (
    <ResourceDetailLayout
      kind="music"
      imageUrl={album.coverArt.frontUrl ?? album.coverArt.frontThumbnailUrl}
      title={album.title}
      subtitle={album.artist ?? t('unknown')}
      description={album.disambiguation}
      badges={[album.releaseYear, album.primaryType, album.country, ...album.secondaryTypes].filter(isString)}
      statusInput={statusInput}
      actions={
        <Button
          type="button"
          onClick={openReleaseSearch}
          size="icon-lg"
          className="size-11 rounded-xl shadow-lg shadow-primary/25"
          aria-label={t('musicDownload')}
          title={t('musicDownload')}
        >
          <Search />
        </Button>
      }
      meta={
        <>
          <ResourceFact
            icon={<CalendarDays />}
            label={t('releaseDate')}
            value={album.releaseDate ?? t('unknownDate')}
          />
          <ResourceFact icon={<Disc3 />} label={t('formats')} value={album.formats.join(', ') || t('unknown')} />
          <ResourceFact icon={<ListMusic />} label={t('tracks')} value={String(getTrackCount(album))} />
        </>
      }
      sections={
        <>
          <ResourceSection title={t('trackList')}>
            {album.media.length > 0 ? (
              <div className="space-y-4">
                {album.media.map((medium) => (
                  <div key={medium.position} className="rounded-xl border p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="font-semibold text-sm">
                        {medium.title ?? medium.format ?? `${t('disc')} ${medium.position}`}
                      </h3>
                      <Badge variant="secondary">{medium.trackCount}</Badge>
                    </div>
                    <div className="space-y-2">
                      {medium.tracks.map((track) => (
                        <div
                          key={`${medium.position}-${track.position}`}
                          className="grid grid-cols-[3rem_minmax(0,1fr)_4rem] gap-3 text-sm"
                        >
                          <span className="text-muted-foreground">{track.number ?? track.position}</span>
                          <span className="truncate">{track.title}</span>
                          <span className="text-right text-muted-foreground">{formatTrackLength(track.lengthMs)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyResourceSection />
            )}
          </ResourceSection>
          <ResourceReleaseDialog
            state={releaseDialog}
            loading={releaseSearch.isPending}
            onClose={() => setReleaseDialog(null)}
            onSearch={() => releaseSearch.mutate(releaseDialog?.input)}
          />
        </>
      }
    />
  )
}

export function BookDetailPage() {
  const location = useLocation()
  const { key } = useParams()
  const { setTopbarOverride } = useOutletContext<AppOutletContext>()
  const { t } = useTranslation()
  const mediaKey = key ?? ''
  const details = useBookDetails(mediaKey)
  const book = details.data ?? null
  const [releaseDialog, setReleaseDialog] = useState<ReleaseDialogState | null>(null)
  const releaseSearch = useResourceReleaseSearch(setReleaseDialog)

  useEffect(() => {
    if (!book) return
    setTopbarOverride({
      pathname: location.pathname,
      title: book.title,
      subtitle: `${t('book')} / ${book.authors.join(', ') || t('unknown')}`,
    })
    return () => setTopbarOverride(null)
  }, [book, location.pathname, setTopbarOverride, t])

  function openBookReleaseSearch(target: 'ebook' | 'audiobook') {
    if (!book) return
    const targetLabel = target === 'ebook' ? t('ebook') : t('audiobook')
    openResourceReleaseSearch({
      input: getBookReleaseSearchInput(book, target),
      label: targetLabel,
      releaseSearch,
      setReleaseDialog,
    })
  }

  if (details.isLoading) return <ResourceDetailSkeleton />
  if (!book)
    return <ResourceDetailError message={details.error instanceof Error ? details.error.message : t('mediaNotFound')} />

  const statusInput = { kind: 'book' as const, mediaKey: book.mediaKey }
  return (
    <ResourceDetailLayout
      kind="book"
      imageUrl={book.coverUrl}
      title={book.title}
      subtitle={book.authors.join(', ') || t('unknown')}
      description={book.description}
      badges={[book.firstPublishYear ? String(book.firstPublishYear) : null, ...book.languages].filter(isString)}
      statusInput={statusInput}
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                size="icon-lg"
                className="size-11 rounded-xl shadow-lg shadow-primary/25"
                aria-label={t('searchDownloads')}
                title={t('searchDownloads')}
              />
            }
          >
            <Search />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => openBookReleaseSearch('ebook')}>
              <Search />
              {t('ebook')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openBookReleaseSearch('audiobook')}>
              <Search />
              {t('audiobook')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
      meta={
        <>
          <ResourceFact
            icon={<CalendarDays />}
            label={t('firstPublished')}
            value={book.firstPublishYear ? String(book.firstPublishYear) : t('unknownYear')}
          />
          <ResourceFact icon={<Languages />} label={t('language')} value={book.languages.join(', ') || t('unknown')} />
          <ResourceFact
            icon={<BookOpen />}
            label="ISBN"
            value={book.isbnCandidates.slice(0, 3).join(', ') || t('unknown')}
          />
        </>
      }
      sections={
        <>
          <ResourceSection title={t('editions')}>
            {book.editionCandidates.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {book.editionCandidates.slice(0, 12).map((edition) => (
                  <Card key={edition.mediaKey} className="p-4">
                    <CardContent className="px-0">
                      <h3 className="line-clamp-2 font-semibold text-sm">{edition.title ?? book.title}</h3>
                      <div className="mt-2 text-muted-foreground text-xs">
                        {[edition.publishYear, edition.languages.join(', '), edition.openLibraryId]
                          .filter(Boolean)
                          .join(' / ')}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyResourceSection />
            )}
          </ResourceSection>
          <ResourceReleaseDialog
            state={releaseDialog}
            loading={releaseSearch.isPending}
            onClose={() => setReleaseDialog(null)}
            onSearch={() => releaseSearch.mutate(releaseDialog?.input)}
          />
        </>
      }
    />
  )
}

function ResourceDetailLayout({
  kind,
  imageUrl,
  title,
  subtitle,
  description,
  badges,
  statusInput,
  actions,
  meta,
  sections,
}: {
  kind: ResourceKind
  imageUrl: string | null | undefined
  title: string
  subtitle: string
  description: string | null
  badges: string[]
  statusInput: LibraryResourceInput
  actions: ReactNode
  meta: ReactNode
  sections: ReactNode
}) {
  const { t } = useTranslation()
  const { getResourceStatus, setResourceStatus } = useLibrary()
  const status = getResourceStatus(statusInput)

  async function updateStatus(nextStatus: MediaStatus) {
    try {
      await setResourceStatus(statusInput, nextStatus)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('mediaStatusToggleFailed'))
    }
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1520px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <section className="overflow-hidden rounded-[28px] bg-[#130d1f] text-white shadow-[0_30px_90px_rgba(33,22,47,0.28)] sm:rounded-[34px]">
        <div className="relative">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              className="absolute inset-0 h-full w-full scale-110 object-cover opacity-22 blur-2xl"
            />
          ) : null}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(19,13,31,.72)_0%,#130d1f_82%)] lg:bg-[linear-gradient(90deg,#130d1f_0%,rgba(19,13,31,.94)_34%,rgba(19,13,31,.74)_72%,#130d1f_100%)]" />

          <div className="relative grid gap-5 p-4 sm:p-5 lg:min-h-[540px] lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start lg:gap-8 lg:p-8">
            <div className="grid grid-cols-[116px_minmax(0,1fr)] gap-4 sm:grid-cols-[156px_minmax(0,1fr)] lg:block">
              <div className="overflow-hidden rounded-[18px] bg-white/8 shadow-[0_24px_60px_rgba(0,0,0,0.44)] ring-1 ring-white/14 sm:rounded-[24px] lg:rounded-[30px]">
                {imageUrl ? (
                  <img src={imageUrl} alt={`${title} cover`} className="aspect-[2/3] w-full object-cover" />
                ) : (
                  <div className="flex aspect-[2/3] items-center justify-center bg-white/8 text-white/66">
                    {kind === 'book' ? <BookOpen className="size-10" /> : <Disc3 className="size-10" />}
                  </div>
                )}
              </div>

              <div className="min-w-0 lg:hidden">
                <div className="flex items-start justify-between gap-2">
                  <Badge variant="secondary" className="gap-2 bg-white/12 text-white/82 backdrop-blur">
                    {kind === 'book' ? <BookOpen className="size-3.5" /> : <Disc3 className="size-3.5" />}
                    {kind === 'book' ? t('book') : t('music')}
                  </Badge>
                  <ResourceStatusButton kind={kind} status={status} onChange={updateStatus} />
                </div>
                <h1 className="mt-4 text-balance font-semibold text-2xl leading-tight sm:text-4xl sm:leading-[0.98]">
                  {title}
                </h1>
                <p className="mt-3 line-clamp-2 text-sm text-white/68">{subtitle}</p>
                <div className="mt-3 flex flex-wrap gap-2">{actions}</div>
              </div>
            </div>

            <div className="min-w-0 lg:pt-2">
              <div className="mb-8 hidden items-center justify-between gap-6 lg:flex">
                <Badge variant="secondary" className="gap-2 bg-white/12 text-white/82 backdrop-blur">
                  {kind === 'book' ? <BookOpen className="size-3.5" /> : <Disc3 className="size-3.5" />}
                  {kind === 'book' ? t('book') : t('music')}
                </Badge>
                <div className="flex shrink-0 items-center gap-2">
                  <ResourceStatusButton kind={kind} status={status} onChange={updateStatus} />
                  {actions}
                </div>
              </div>

              <div className="hidden lg:block">
                <h1 className="max-w-4xl text-balance font-semibold text-4xl leading-none sm:text-5xl lg:text-6xl">
                  {title}
                </h1>
                <p className="mt-4 max-w-3xl text-lg text-white/70">{subtitle}</p>
              </div>

              <div className="mt-5 flex flex-wrap gap-2 lg:mt-6">
                {badges.map((badge) => (
                  <Badge key={badge} variant="secondary" className="bg-white/12 text-white/76 backdrop-blur">
                    {badge}
                  </Badge>
                ))}
              </div>
              {description ? (
                <p className="mt-5 line-clamp-6 max-w-4xl text-white/78 leading-7 sm:text-lg sm:leading-8 lg:line-clamp-7">
                  {description}
                </p>
              ) : null}
              <div className="mt-6 grid gap-3 md:grid-cols-3">{meta}</div>
            </div>
          </div>
        </div>
      </section>
      <div className="mt-7">{sections}</div>
    </div>
  )
}

function ResourceStatusButton({
  kind,
  status,
  onChange,
}: {
  kind: ResourceKind
  status: MediaStatus
  onChange: (nextStatus: MediaStatus) => Promise<void>
}) {
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant={status === 'none' ? 'outline' : 'secondary'}
            size="icon-lg"
            className="size-11 shrink-0 rounded-xl border-white/18 bg-white/12 text-white shadow-lg backdrop-blur hover:bg-white/20 hover:text-white"
            aria-label={t('mediaStatus')}
            title={t('mediaStatus')}
          />
        }
      >
        {status === 'watched' ? (
          <CircleCheck className="fill-[#77d6a8] text-[#123524]" />
        ) : (
          <Heart className={cn(status === 'saved' && 'fill-[#f06595] text-[#f06595]')} />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => void onChange('saved')}>
          <Heart className={cn(status === 'saved' && 'fill-[#f06595] text-[#f06595]')} />
          {t('saveToLibrary')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void onChange('watched')}>
          <CircleCheck className={cn(status === 'watched' && 'fill-[#77d6a8] text-[#123524]')} />
          {kind === 'music' ? t('markListened') : t('markRead')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void onChange('none')} disabled={status === 'none'}>
          <RotateCcw />
          {t('clearMediaStatus')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MusicAlbumCard({ item }: { item: MusicAlbumSearchItem }) {
  return (
    <ResourceCard
      kind="music"
      mediaKey={item.mediaKey}
      to={`/music/${encodeURIComponent(item.mediaKey)}`}
      imageUrl={item.coverArt.frontThumbnailUrl ?? item.coverArt.frontUrl}
      title={item.title}
      overlayMeta={item.releaseYear ?? item.artist ?? null}
      badge={item.secondaryTypes[0] ?? item.primaryType ?? null}
      score={item.scoreLabel ?? item.releaseYear ?? 'NR'}
    />
  )
}

function BookCard({ item }: { item: BookSearchItem }) {
  return (
    <ResourceCard
      kind="book"
      mediaKey={item.mediaKey}
      to={`/books/${encodeURIComponent(item.mediaKey)}`}
      imageUrl={item.coverUrl}
      title={item.title}
      overlayMeta={item.authors[0] ?? (item.firstPublishYear ? String(item.firstPublishYear) : null)}
      badge={null}
      score={item.firstPublishYear ? String(item.firstPublishYear) : 'NR'}
    />
  )
}

export function LibraryResourceCard({ kind, mediaKey }: { kind: ResourceKind; mediaKey: string }) {
  const music = useMusicAlbumDetails(mediaKey, { enabled: kind === 'music' })
  const book = useBookDetails(mediaKey, { enabled: kind === 'book' })
  const loading = kind === 'music' ? music.isLoading : book.isLoading

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="aspect-[2/3] rounded-xl" />
        <Skeleton className="mx-1 h-4 w-2/3" />
        <Skeleton className="mx-1 h-3 w-1/2" />
      </div>
    )
  }

  if (kind === 'music' && music.data) return <MusicAlbumCard item={music.data} />
  if (kind === 'book' && book.data) return <BookCard item={book.data} />

  return (
    <Card className="flex aspect-[2/3] items-center justify-center break-all p-4 text-center text-muted-foreground text-sm">
      {mediaKey}
    </Card>
  )
}

function ResourceCard({
  kind,
  mediaKey,
  to,
  imageUrl,
  title,
  overlayMeta,
  badge,
  score,
}: {
  kind: ResourceKind
  mediaKey: string
  to: string
  imageUrl: string | null | undefined
  title: string
  overlayMeta: string | null
  badge: string | null
  score: string
}) {
  const { t } = useTranslation()
  const { getResourceStatus, setResourceStatus } = useLibrary()
  const status = getResourceStatus({ kind, mediaKey })

  async function handleStatusChange(nextStatus: MediaStatus) {
    try {
      await setResourceStatus({ kind, mediaKey }, nextStatus)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('mediaStatusToggleFailed'))
    }
  }

  return (
    <Card className="group gap-0 overflow-visible bg-transparent p-0 ring-0">
      <CardContent className="relative aspect-[2/3] overflow-hidden rounded-xl bg-card p-0 shadow-[0_18px_38px_rgba(33,22,47,0.18)] ring-1 ring-foreground/10 transition duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_28px_58px_rgba(124,58,237,0.18)]">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`${title} cover`}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            {kind === 'book' ? <BookOpen className="size-8" /> : <Disc3 className="size-8" />}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#120c1d] via-[#120c1d]/18 to-transparent opacity-92" />
        <Link to={to} aria-label={title} className="absolute inset-0 z-10" />
        <ResourceCardStatusMenu kind={kind} status={status} onChange={handleStatusChange} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-4 text-white">
          <div className="mb-2 flex items-center gap-2 text-white/72 text-xs">
            {badge ? (
              <Badge variant="secondary" className="bg-white/14 text-white backdrop-blur">
                {badge}
              </Badge>
            ) : null}
            <span className="truncate">{overlayMeta ?? t('unknown')}</span>
          </div>
          <h2 className="line-clamp-2 text-balance font-semibold text-base leading-tight drop-shadow sm:text-xl">
            {title}
          </h2>
        </div>
      </CardContent>
      <CardContent className="px-1 pt-3">
        <div className="flex min-w-0 items-center justify-between gap-2 text-muted-foreground text-sm">
          <Tooltip>
            <TooltipTrigger className="min-w-0">
              <span className="block max-w-full truncate text-left">{title}</span>
            </TooltipTrigger>
            <TooltipContent>{title}</TooltipContent>
          </Tooltip>
          <span className="shrink-0 font-medium text-foreground text-xs">{score}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function ResourceCardStatusMenu({
  kind,
  status,
  onChange,
}: {
  kind: ResourceKind
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
        <DropdownMenuContent align="end" className="w-44" onClick={(event) => event.stopPropagation()}>
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
            {kind === 'music' ? t('markListened') : t('markRead')}
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

interface ReleaseDialogState {
  item: ReleaseSearchMedia
  label: string
  query: string
  releases: IndexerSearchItem[]
  error: ReleaseSearchError | null
  input: ResourceReleaseSearchInput
}

interface ResourceReleaseSearchInput {
  target: DownloadSearchTarget
  query: string
  item: ReleaseSearchMedia
  title: string
  aliases: string[]
  creators: string[]
  year: string | null
  formats: string[]
  narrator: string | null
}

function useResourceReleaseSearch(setReleaseDialog: (state: ReleaseDialogState | null) => void) {
  const { t } = useTranslation()

  return useMutation({
    mutationFn: async (input: ResourceReleaseSearchInput | undefined) => {
      if (!input) throw new Error('Release search input is missing.')
      const payload = await searchIndexers({
        query: input.query,
        target: input.target,
        title: input.title,
        aliases: input.aliases,
        creators: input.creators,
        year: input.year,
        formats: input.formats,
        narrator: input.narrator,
      })
      return { input, results: payload.results }
    },
    onSuccess: ({ input, results }) => {
      setReleaseDialog({
        item: input.item,
        label: input.target,
        query: input.query,
        releases: results,
        error: null,
        input,
      })
    },
    onError: (error, input) => {
      if (!input) return
      setReleaseDialog({
        item: input.item,
        label: input.target,
        query: input.query,
        releases: [],
        error: getReleaseSearchError(error, t),
        input,
      })
    },
  })
}

function openResourceReleaseSearch({
  input,
  label,
  releaseSearch,
  setReleaseDialog,
}: {
  input: ResourceReleaseSearchInput
  label: string
  releaseSearch: ReturnType<typeof useResourceReleaseSearch>
  setReleaseDialog: (state: ReleaseDialogState | null) => void
}) {
  setReleaseDialog({ item: input.item, label, query: input.query, releases: [], error: null, input })
  releaseSearch.mutate(input)
}

function ResourceReleaseDialog({
  state,
  loading,
  onClose,
  onSearch,
}: {
  state: ReleaseDialogState | null
  loading: boolean
  onClose: () => void
  onSearch: () => void
}) {
  if (!state) return null

  return (
    <ReleaseSearchDialog
      media={state.item}
      query={state.query}
      items={state.releases}
      loading={loading}
      error={state.error}
      onClose={onClose}
      onSearch={onSearch}
    />
  )
}

export function getMusicReleaseSearchInput(album: MusicAlbumDetails): ResourceReleaseSearchInput {
  const creators = getMusicCreators(album)
  const formats = uniqueStrings([...album.formats, album.primaryType, ...album.secondaryTypes, 'flac', 'mp3'])
  const aliases = uniqueStrings([
    ...album.aliases.map((alias) => alias.name),
    ...album.releases.map((release) => release.title),
  ])
  const query = [album.title, creators[0], album.releaseYear, formats[0]].filter(Boolean).join(' ')

  return {
    target: 'music',
    query,
    item: toMusicReleaseMedia(album),
    title: album.title,
    aliases,
    creators,
    year: album.releaseYear,
    formats,
    narrator: null,
  }
}

export function getBookReleaseSearchInput(
  book: BookDetails,
  target: Extract<DownloadSearchTarget, 'ebook' | 'audiobook'>,
): ResourceReleaseSearchInput {
  const targetFormat = target === 'ebook' ? 'ebook' : 'audiobook'
  const formats = target === 'ebook' ? ['ebook', 'epub', 'mobi', 'azw3', 'pdf'] : ['audiobook', 'm4b', 'm4a', 'mp3']
  const year = book.firstPublishYear ? String(book.firstPublishYear) : null
  const query = [book.title, book.authors[0], year, targetFormat].filter(Boolean).join(' ')

  return {
    target,
    query,
    item: toBookReleaseMedia(book, target),
    title: book.title,
    aliases: uniqueStrings(book.aliases),
    creators: uniqueStrings(book.authors),
    year,
    formats,
    narrator: null,
  }
}

function toMusicReleaseMedia(album: MusicAlbumDetails): ReleaseSearchMedia {
  return {
    id: 0,
    kind: 'movie',
    title: album.title,
    originalTitle: album.title,
    overview: album.disambiguation ?? '',
    posterUrl: album.coverArt.frontUrl,
    backdropUrl: null,
    releaseYear: album.releaseYear,
    rating: null,
    genres: album.secondaryTypes,
    downloadCategory: 'zme:music',
    downloadTags: [`mediaKey=${album.mediaKey}`, 'kind=music'],
  }
}

function toBookReleaseMedia(book: BookDetails, target: 'ebook' | 'audiobook'): ReleaseSearchMedia {
  return {
    id: 0,
    kind: 'movie',
    title: book.title,
    originalTitle: book.title,
    overview: book.description ?? '',
    posterUrl: book.coverUrl,
    backdropUrl: null,
    releaseYear: book.firstPublishYear ? String(book.firstPublishYear) : null,
    rating: null,
    genres: book.languages,
    downloadCategory: `zme:${target}`,
    downloadTags: [`mediaKey=${book.mediaKey}`, 'kind=book', `target=${target}`],
  }
}

function getMusicCreators(album: MusicAlbumDetails) {
  return uniqueStrings([...album.artists.map((artist) => artist.name), album.artist])
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))))
}

function ResourceFact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/10 p-4 text-white backdrop-blur ring-1 ring-white/10">
      <div className="flex items-center gap-2 text-white/58 text-xs">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 truncate font-medium text-sm">{value}</div>
    </div>
  )
}

function ResourceSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 font-semibold text-xl">{title}</h2>
      {children}
    </section>
  )
}

function EmptyResourceSection() {
  const { t } = useTranslation()
  return (
    <Card className="flex min-h-40 items-center justify-center p-6 text-muted-foreground">
      {t('noResourceDetails')}
    </Card>
  )
}

function ResourceGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-4 sm:gap-y-7 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
      {resourceSkeletonKeys.map((key) => (
        <div key={key} className="flex flex-col gap-3">
          <Skeleton className="aspect-[2/3] rounded-xl" />
          <Skeleton className="mx-1 h-4 w-2/3" />
          <Skeleton className="mx-1 h-3 w-1/2" />
        </div>
      ))}
    </div>
  )
}

function ResourceDetailSkeleton() {
  return (
    <div className="mx-auto w-full min-w-0 max-w-[1520px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <div className="grid gap-5 rounded-2xl border bg-card p-4 sm:p-5 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-7 lg:p-6">
        <Skeleton className="aspect-[2/3] rounded-xl" />
        <div className="space-y-4">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  )
}

function ResourceDetailError({ message }: { message: string }) {
  return (
    <div className="mx-auto w-full min-w-0 max-w-[1520px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <Card className="flex min-h-80 items-center justify-center p-8 text-muted-foreground">{message}</Card>
    </div>
  )
}

function getReleaseSearchError(error: unknown, t: (key: string) => string): ReleaseSearchError {
  if (error instanceof ApiError && error.status === 404) {
    return {
      title: t('indexerNotConfiguredTitle'),
      description: t('indexerNotConfiguredDescription'),
      action: t('retrySearch'),
      tone: 'configuration',
    }
  }

  return {
    title: t('indexerSearchFailedTitle'),
    description: error instanceof Error ? error.message : t('indexerSearchFailedDescription'),
    action: t('retrySearch'),
    tone: 'generic',
  }
}

function getTrackCount(album: MusicAlbumDetails) {
  return album.media.reduce((total, medium) => total + medium.trackCount, 0)
}

function formatTrackLength(lengthMs: number | null) {
  if (!lengthMs) return ''
  const totalSeconds = Math.round(lengthMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

function isString(value: string | null | undefined): value is string {
  return Boolean(value)
}
