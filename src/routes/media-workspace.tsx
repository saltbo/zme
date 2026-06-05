import type { MediaDiscoverSort, MediaKind, MediaSearchItem } from '@shared/types'
import { SlidersHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useOutletContext, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import type { AppOutletContext } from '@/components/app-shell/types'
import { DiscoverFilterBar, FilterBar, MediaWall } from '@/components/media/media-components'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDiscoverMedia, useMediaGenres, useMediaSearch } from '@/hooks/use-media-queries'
import { getTmdbLanguage } from '@/i18n'
import {
  compareResourceTitle,
  getResourceSearchSort,
  getResourceSearchSortOptions,
  parseResourceYear,
  type ResourceSearchSort,
} from '@/lib/resource-search-sort'
import { DiscoverPage } from '@/routes/discover'

type MediaWorkspaceMode = 'discover' | MediaKind | 'animation'

const ANIMATION_GENRE_ID = 16

export function MediaWorkspace({ mode }: { mode: MediaWorkspaceMode }) {
  const { i18n, t } = useTranslation()
  const location = useLocation()
  const { setTopbarOverride } = useOutletContext<AppOutletContext>()
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const searchQuery = searchParams.get('q')?.trim() ?? ''
  const tmdbLanguage = getTmdbLanguage(i18n.language)
  const hasSearched = searchQuery.length > 0
  const searchSort = getResourceSearchSort(searchParams.get('sort'))
  const sortBy = getSortBy(searchParams.get('sort'), mode)
  const mediaKind = getMediaKind(mode)
  const genreId = getNumberParam(searchParams.get('genre')) ?? (mode === 'animation' ? ANIMATION_GENRE_ID : undefined)
  const originCountry = getCountryParam(searchParams.get('country'))
  const year = getYearParam(searchParams.get('year'))
  const ratingGte = getNumberParam(searchParams.get('rating'))
  const discover = useDiscoverMedia(
    {
      kind: mediaKind,
      language: tmdbLanguage,
      sortBy,
      genreId,
      originCountry,
      year: year ? Number(year) : undefined,
      ratingGte,
    },
    {
      enabled: mode !== 'discover' && !hasSearched,
    },
  )
  const genres = useMediaGenres(mediaKind, tmdbLanguage, {
    enabled: mode !== 'discover' && !hasSearched,
  })
  const search = useMediaSearch(searchQuery, tmdbLanguage)
  const media = hasSearched ? (search.data ?? []) : (discover.data?.pages.flatMap((page) => page.results) ?? [])
  const visibleMedia = hasSearched
    ? sortMediaSearchResults(
        media.filter((item) => mode === 'discover' || item.kind === mediaKind),
        searchSort,
      )
    : media
  const totalResults = discover.data?.pages[0]?.totalResults ?? 0
  const error = hasSearched ? search.error : discover.error

  useEffect(() => {
    if (!error) return
    toast.error(error instanceof Error ? error.message : hasSearched ? t('searchFailed') : t('mediaLoadFailed'))
  }, [error, hasSearched, t])

  useEffect(() => {
    if (mode === 'discover' || hasSearched) {
      setTopbarOverride(null)
      return
    }

    setTopbarOverride({
      pathname: location.pathname,
      title: getWorkspaceTitle(mode, t),
      subtitle: getWorkspaceSubtitle(mode, t),
      actions: (
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
      ),
    })

    return () => setTopbarOverride(null)
  }, [hasSearched, location.pathname, mode, setTopbarOverride, t])

  useEffect(() => {
    const target = loadMoreRef.current
    if (!target || hasSearched || !discover.hasNextPage) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !discover.isFetchingNextPage) {
          void discover.fetchNextPage()
        }
      },
      { rootMargin: '480px 0px' },
    )

    observer.observe(target)
    return () => observer.disconnect()
  }, [discover.fetchNextPage, discover.hasNextPage, discover.isFetchingNextPage, hasSearched])

  if (mode === 'discover' && !hasSearched) {
    return <DiscoverPage />
  }

  function updateFilter(key: string, value: string | undefined) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    })
  }

  function resetFilters() {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('sort')
      next.delete('genre')
      next.delete('country')
      next.delete('year')
      next.delete('rating')
      return next
    })
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1680px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      {hasSearched ? (
        <div className="mb-5 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
          <FilterBar mode={mode} resultCount={visibleMedia.length} compact />
          <ResourceSearchSortSelect
            value={searchSort}
            onChange={(value) => updateFilter('sort', value === 'best' ? undefined : value)}
          />
        </div>
      ) : (
        <DiscoverFilterBar
          kind={mediaKind}
          genres={genres.data ?? []}
          genresLoading={genres.isLoading}
          totalResults={totalResults}
          sortBy={sortBy}
          genreId={genreId}
          originCountry={originCountry}
          year={year}
          ratingGte={ratingGte}
          mobileFiltersOpen={mobileFiltersOpen}
          onSortByChange={(value) => updateFilter('sort', value === 'popularity.desc' ? undefined : value)}
          onGenreIdChange={(value) => updateFilter('genre', value ? String(value) : undefined)}
          onOriginCountryChange={(value) => updateFilter('country', value)}
          onYearChange={(value) => updateFilter('year', value || undefined)}
          onRatingGteChange={(value) => updateFilter('rating', value ? String(value) : undefined)}
          onMobileFiltersOpenChange={setMobileFiltersOpen}
          onReset={resetFilters}
        />
      )}
      <MediaWall items={visibleMedia} loading={hasSearched ? search.isLoading : discover.isLoading} />
      {!hasSearched ? (
        <div ref={loadMoreRef} className="mt-8 flex min-h-10 items-center justify-center text-muted-foreground text-sm">
          {discover.isFetchingNextPage
            ? t('loadingMore')
            : discover.hasNextPage
              ? t('scrollToLoadMore')
              : t('noMoreMedia')}
        </div>
      ) : null}
    </div>
  )
}

function ResourceSearchSortSelect({
  value,
  onChange,
}: {
  value: ResourceSearchSort
  onChange: (value: ResourceSearchSort) => void
}) {
  const { t } = useTranslation()
  const sortOptions = getResourceSearchSortOptions(t)

  return (
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
  )
}

function sortMediaSearchResults(items: MediaSearchItem[], sort: ResourceSearchSort) {
  if (sort === 'best') return items

  return [...items].sort((left, right) => {
    if (sort === 'title') return compareResourceTitle(left.title, right.title)

    const leftYear = parseResourceYear(left.releaseYear)
    const rightYear = parseResourceYear(right.releaseYear)
    const yearComparison = sort === 'newest' ? rightYear - leftYear : leftYear - rightYear
    return yearComparison || compareResourceTitle(left.title, right.title)
  })
}

function getSortBy(value: string | null, mode: MediaWorkspaceMode): MediaDiscoverSort {
  if (value === 'vote_average.desc' || value === 'popularity.desc') return value
  if (mode === 'movie' && value === 'primary_release_date.desc') return value
  if ((mode === 'tv' || mode === 'animation') && value === 'first_air_date.desc') return value
  return 'popularity.desc'
}

function getMediaKind(mode: MediaWorkspaceMode): MediaKind {
  if (mode === 'movie') return 'movie'
  return 'tv'
}

function getWorkspaceTitle(mode: Exclude<MediaWorkspaceMode, 'discover'>, t: (key: string) => string) {
  if (mode === 'movie') return t('movies')
  if (mode === 'animation') return t('animations')
  return t('series')
}

function getWorkspaceSubtitle(mode: Exclude<MediaWorkspaceMode, 'discover'>, t: (key: string) => string) {
  if (mode === 'movie') return t('moviesSubtitle')
  if (mode === 'animation') return t('animationsSubtitle')
  return t('seriesSubtitle')
}

function getNumberParam(value: string | null): number | undefined {
  if (!value) return undefined
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined
}

function getCountryParam(value: string | null): string | undefined {
  if (!value || !/^[A-Z]{2}$/.test(value)) return undefined
  return value
}

function getYearParam(value: string | null): string {
  if (!value || !/^(19|20)\d{2}$/.test(value)) return ''
  return value
}
