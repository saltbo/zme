import type { MediaDiscoverSort, MediaKind } from '@shared/types'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { DiscoverFilterBar, FilterBar, MediaWall } from '@/components/media/media-components'
import { useDiscoverMedia, useMediaGenres, useMediaSearch } from '@/hooks/use-media-queries'
import { getTmdbLanguage } from '@/i18n'
import { DiscoverPage } from '@/routes/discover'

export function MediaWorkspace({ mode }: { mode: 'discover' | MediaKind }) {
  const { i18n, t } = useTranslation()
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const searchQuery = searchParams.get('q')?.trim() ?? ''
  const tmdbLanguage = getTmdbLanguage(i18n.language)
  const hasSearched = searchQuery.length > 0
  const sortBy = getSortBy(searchParams.get('sort'), mode)
  const genreId = getNumberParam(searchParams.get('genre'))
  const originCountry = getCountryParam(searchParams.get('country'))
  const year = getYearParam(searchParams.get('year'))
  const ratingGte = getNumberParam(searchParams.get('rating'))
  const discover = useDiscoverMedia(
    {
      kind: mode === 'discover' ? 'movie' : mode,
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
  const genres = useMediaGenres(mode === 'discover' ? 'movie' : mode, tmdbLanguage, {
    enabled: mode !== 'discover' && !hasSearched,
  })
  const search = useMediaSearch(searchQuery, tmdbLanguage)
  const media = hasSearched ? (search.data ?? []) : (discover.data?.pages.flatMap((page) => page.results) ?? [])
  const visibleMedia = hasSearched ? media.filter((item) => mode === 'discover' || item.kind === mode) : media
  const totalResults = discover.data?.pages[0]?.totalResults ?? 0
  const error = hasSearched ? search.error : discover.error

  useEffect(() => {
    if (!error) return
    toast.error(error instanceof Error ? error.message : hasSearched ? t('searchFailed') : t('mediaLoadFailed'))
  }, [error, hasSearched, t])

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
        <FilterBar mode={mode} resultCount={visibleMedia.length} />
      ) : (
        <DiscoverFilterBar
          kind={mode === 'discover' ? 'movie' : mode}
          genres={genres.data ?? []}
          genresLoading={genres.isLoading}
          resultCount={visibleMedia.length}
          totalResults={totalResults}
          sortBy={sortBy}
          genreId={genreId}
          originCountry={originCountry}
          year={year}
          ratingGte={ratingGte}
          onSortByChange={(value) => updateFilter('sort', value === 'popularity.desc' ? undefined : value)}
          onGenreIdChange={(value) => updateFilter('genre', value ? String(value) : undefined)}
          onOriginCountryChange={(value) => updateFilter('country', value)}
          onYearChange={(value) => updateFilter('year', value || undefined)}
          onRatingGteChange={(value) => updateFilter('rating', value ? String(value) : undefined)}
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

function getSortBy(value: string | null, mode: 'discover' | MediaKind): MediaDiscoverSort {
  if (value === 'vote_average.desc' || value === 'popularity.desc') return value
  if (mode === 'movie' && value === 'primary_release_date.desc') return value
  if (mode === 'tv' && value === 'first_air_date.desc') return value
  return 'popularity.desc'
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
