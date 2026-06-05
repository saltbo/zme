import type { MediaDiscoverSort, MediaGenre, MediaKind, MediaSearchItem } from '@shared/types'
import { Heart, RotateCcw, Star } from 'lucide-react'
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useFavorites } from '@/contexts/favorites'
import { cn } from '@/lib/utils'

const mediaSkeletonKeys = [
  'media-skeleton-1',
  'media-skeleton-2',
  'media-skeleton-3',
  'media-skeleton-4',
  'media-skeleton-5',
  'media-skeleton-6',
]

export function MediaRail({
  title,
  subtitle,
  items,
  moreTo,
  loading,
}: {
  title: string
  subtitle: string
  items: MediaSearchItem[]
  moreTo?: string
  loading?: boolean
}) {
  const { t } = useTranslation()

  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-semibold text-xl">{title}</h2>
          <p className="mt-1 text-muted-foreground text-sm">{subtitle}</p>
        </div>
        {moreTo ? (
          <Link
            to={moreTo}
            className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'shrink-0 rounded-full')}
          >
            {t('viewAll')}
          </Link>
        ) : null}
      </div>
      <div className="zme-x-scroll -mx-4 flex gap-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {loading
          ? mediaSkeletonKeys.map((key) => (
              <div key={`${title}-${key}`} className="w-[150px] shrink-0 sm:w-[190px] md:w-[210px] 2xl:w-[230px]">
                <Skeleton className="aspect-[2/3] rounded-xl" />
              </div>
            ))
          : items.map((item) => (
              <div
                key={`rail-${title}-${item.kind}-${item.id}`}
                className="w-[150px] shrink-0 sm:w-[190px] md:w-[210px] 2xl:w-[230px]"
              >
                <MediaCard item={item} />
              </div>
            ))}
        {!loading && items.length === 0 ? (
          <Card className="flex min-h-64 min-w-full items-center justify-center p-8 text-muted-foreground">
            {t('noMedia')}
          </Card>
        ) : null}
      </div>
    </section>
  )
}

export function FilterBar({ mode, resultCount }: { mode: 'discover' | MediaKind | 'favorites'; resultCount: number }) {
  const { t } = useTranslation()
  const copy =
    mode === 'favorites'
      ? t('favoritesOnly')
      : mode === 'discover'
        ? t('mixedDiscoveryWall')
        : mode === 'movie'
          ? t('moviesOnly')
          : t('seriesOnly')

  return (
    <div className="mb-5 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <Badge variant="secondary" className="h-8 rounded-full px-3 font-semibold">
          {resultCount} {t('titles')}
        </Badge>
        <span className="text-muted-foreground text-sm">{copy}</span>
      </div>
    </div>
  )
}

export function DiscoverFilterBar({
  kind,
  genres,
  genresLoading,
  resultCount,
  totalResults,
  sortBy,
  genreId,
  originCountry,
  year,
  ratingGte,
  mobileFiltersOpen,
  onSortByChange,
  onGenreIdChange,
  onOriginCountryChange,
  onYearChange,
  onRatingGteChange,
  onMobileFiltersOpenChange,
  onReset,
}: {
  kind: MediaKind
  genres: MediaGenre[]
  genresLoading: boolean
  resultCount: number
  totalResults: number
  sortBy: MediaDiscoverSort
  genreId?: number
  originCountry?: string
  year: string
  ratingGte?: number
  mobileFiltersOpen: boolean
  onSortByChange: (value: MediaDiscoverSort) => void
  onGenreIdChange: (value: number | undefined) => void
  onOriginCountryChange: (value: string | undefined) => void
  onYearChange: (value: string) => void
  onRatingGteChange: (value: number | undefined) => void
  onMobileFiltersOpenChange: (open: boolean) => void
  onReset: () => void
}) {
  const { t } = useTranslation()
  const hasFilters =
    sortBy !== 'popularity.desc' ||
    genreId !== undefined ||
    originCountry !== undefined ||
    year.length > 0 ||
    ratingGte !== undefined
  const sortOptions = getSortOptions(kind, t)
  const genreOptions = [
    { label: t('allGenres'), value: 'all' },
    ...genres.map((genre) => ({ label: genre.name, value: String(genre.id) })),
  ]
  const countryOptions = getCountryOptions(t)
  const ratingOptions = [
    { label: t('anyRating'), value: 'all' },
    { label: '5+', value: '5' },
    { label: '6+', value: '6' },
    { label: '7+', value: '7' },
    { label: '8+', value: '8' },
  ]
  const filterControls = (yearId: string) => (
    <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[1.1fr_1fr_1fr_0.75fr_0.85fr]">
      <div className="min-w-0">
        <span className="mb-1 block font-medium text-muted-foreground text-xs">{t('sort')}</span>
        <Select
          items={sortOptions}
          value={sortBy}
          onValueChange={(value) => onSortByChange((value || 'popularity.desc') as MediaDiscoverSort)}
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
      <div className="min-w-0">
        <span className="mb-1 block font-medium text-muted-foreground text-xs">{t('genre')}</span>
        <Select
          items={genreOptions}
          value={genreId ? String(genreId) : 'all'}
          onValueChange={(value) => onGenreIdChange(value && value !== 'all' ? Number(value) : undefined)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={genresLoading ? t('loadingGenres') : t('allGenres')} />
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false}>
            <SelectGroup>
              <SelectItem value="all">{t('allGenres')}</SelectItem>
              {genres.map((genre) => (
                <SelectItem key={genre.id} value={String(genre.id)}>
                  {genre.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-0">
        <span className="mb-1 block font-medium text-muted-foreground text-xs">{t('country')}</span>
        <Select
          items={countryOptions}
          value={originCountry ?? 'all'}
          onValueChange={(value) => onOriginCountryChange(value && value !== 'all' ? value : undefined)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false}>
            <SelectGroup>
              {countryOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-0">
        <label htmlFor={yearId} className="mb-1 block font-medium text-muted-foreground text-xs">
          {t('year')}
        </label>
        <Input
          id={yearId}
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="2026"
          value={year}
          onChange={(event) => onYearChange(event.target.value.replace(/\D/g, '').slice(0, 4))}
        />
      </div>
      <div className="min-w-0">
        <span className="mb-1 block font-medium text-muted-foreground text-xs">{t('minimumRating')}</span>
        <Select
          items={ratingOptions}
          value={ratingGte ? String(ratingGte) : 'all'}
          onValueChange={(value) => onRatingGteChange(value && value !== 'all' ? Number(value) : undefined)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false}>
            <SelectGroup>
              <SelectItem value="all">{t('anyRating')}</SelectItem>
              <SelectItem value="5">5+</SelectItem>
              <SelectItem value="6">6+</SelectItem>
              <SelectItem value="7">7+</SelectItem>
              <SelectItem value="8">8+</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </div>
  )

  return (
    <>
      <div className="mb-5 hidden border-b pb-4 md:block">
        <div className="mb-3 flex items-center justify-between gap-3">
          <Badge variant="secondary" className="h-8 rounded-full px-3 font-semibold">
            {totalResults > 0 ? `${totalResults} ${t('results')}` : t('tmdbDiscovery')}
          </Badge>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-9 shrink-0 rounded-full"
            disabled={!hasFilters}
            onClick={onReset}
          >
            <RotateCcw data-icon="inline-start" />
            {t('resetFilters')}
          </Button>
        </div>
        {filterControls('media-discover-year')}
      </div>
      <Sheet open={mobileFiltersOpen} onOpenChange={onMobileFiltersOpenChange}>
        <SheetContent side="bottom" className="max-h-[86dvh] overflow-y-auto rounded-t-xl">
          <SheetHeader>
            <SheetTitle>{t('filters')}</SheetTitle>
            <SheetDescription>
              {totalResults > 0 ? `${totalResults} ${t('results')}` : t('tmdbDiscovery')}
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            {filterControls('media-discover-year-mobile')}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" disabled={!hasFilters} onClick={onReset}>
                <RotateCcw data-icon="inline-start" />
                {t('resetFilters')}
              </Button>
              <Button type="button" onClick={() => onMobileFiltersOpenChange(false)}>
                {t('save')}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

function getSortOptions(kind: MediaKind, t: ReturnType<typeof useTranslation>['t']) {
  return [
    { value: 'popularity.desc' as const, label: t('sortByPopularity') },
    {
      value: kind === 'movie' ? ('primary_release_date.desc' as const) : ('first_air_date.desc' as const),
      label: t('sortByNewest'),
    },
    { value: 'vote_average.desc' as const, label: t('sortByRating') },
  ]
}

function getCountryOptions(t: ReturnType<typeof useTranslation>['t']) {
  return [
    { label: t('allCountries'), value: 'all' },
    { label: t('countryCN'), value: 'CN' },
    { label: t('countryDE'), value: 'DE' },
    { label: t('countryFR'), value: 'FR' },
    { label: t('countryGB'), value: 'GB' },
    { label: t('countryHK'), value: 'HK' },
    { label: t('countryIN'), value: 'IN' },
    { label: t('countryJP'), value: 'JP' },
    { label: t('countryKR'), value: 'KR' },
    { label: t('countryTH'), value: 'TH' },
    { label: t('countryTW'), value: 'TW' },
    { label: t('countryUS'), value: 'US' },
  ]
}

export function MediaWall({ items, loading }: { items: MediaSearchItem[]; loading: boolean }) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-4 sm:gap-y-7 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
        {mediaSkeletonKeys.map((key) => (
          <div key={key} className="flex flex-col gap-3">
            <Skeleton className="aspect-[2/3] rounded-xl" />
            <Skeleton className="mx-1 h-4 w-2/3" />
            <Skeleton className="mx-1 h-3 w-1/2" />
          </div>
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <Card className="flex min-h-80 items-center justify-center p-8 text-muted-foreground">{t('noMatchedMedia')}</Card>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-4 sm:gap-y-7 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
      {items.map((item) => (
        <MediaCard key={`${item.kind}-${item.id}`} item={item} />
      ))}
    </div>
  )
}

function MediaCard({ item }: { item: MediaSearchItem }) {
  const { t } = useTranslation()
  const { isFavorite, toggleFavorite } = useFavorites()
  const favorited = isFavorite(item)
  const detailPath = item.kind === 'movie' ? `/movies/${item.id}` : `/series/${item.id}`
  const primaryGenre = item.genres[0]

  async function handleFavoriteClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    try {
      await toggleFavorite(item)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('favoriteToggleFailed'))
    }
  }

  return (
    <Card className="group gap-0 overflow-visible bg-transparent p-0 ring-0">
      <Link to={detailPath} state={{ media: item }} className="block">
        <CardContent className="relative aspect-[2/3] overflow-hidden rounded-xl bg-card p-0 shadow-[0_18px_38px_rgba(33,22,47,0.18)] ring-1 ring-foreground/10 transition duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_28px_58px_rgba(124,58,237,0.18)]">
          {item.posterUrl ? (
            <img
              src={item.posterUrl}
              alt={`${item.title} poster`}
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">{t('noPoster')}</div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#120c1d] via-[#120c1d]/18 to-transparent opacity-92" />
          <button
            type="button"
            onClick={(event) => void handleFavoriteClick(event)}
            aria-label={favorited ? t('removeFavorite') : t('addFavorite')}
            className={cn(
              'absolute top-2 right-2 flex size-10 items-center justify-center text-white/86 drop-shadow-[0_2px_6px_rgba(0,0,0,0.55)] transition hover:scale-110 hover:text-[#f06595] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f06595] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent md:group-hover:opacity-100',
              favorited ? 'opacity-100' : 'opacity-100 md:opacity-0',
            )}
          >
            <Heart className={cn('size-6', favorited && 'fill-[#f06595] text-[#f06595]')} />
          </button>
          <div className="absolute inset-x-0 bottom-0 p-4 text-white">
            <div className="mb-2 flex items-center gap-2 text-white/72 text-xs">
              {primaryGenre ? (
                <Badge variant="secondary" className="bg-white/14 text-white backdrop-blur">
                  {primaryGenre}
                </Badge>
              ) : null}
              <span>{item.releaseYear ?? t('unknown')}</span>
            </div>
            <h2 className="line-clamp-2 text-balance font-semibold text-base leading-tight drop-shadow sm:text-xl">
              {item.originalTitle}
            </h2>
          </div>
        </CardContent>
      </Link>
      <CardContent className="px-1 pt-3">
        <div className="flex items-center justify-between gap-2 text-muted-foreground text-sm">
          <span className="line-clamp-1">{item.title}</span>
          <span className="flex shrink-0 items-center gap-1 font-medium text-foreground">
            <Star className="size-3.5 fill-[#f6c177] text-[#f6c177]" />
            {item.rating ? item.rating.toFixed(1) : 'NR'}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
