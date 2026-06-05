import type {
  IndexerSearchItem,
  MediaDetails,
  MediaImage,
  MediaKind,
  MediaVideo,
  MediaWatchProviderGroupType,
} from '@shared/types'
import { useMutation } from '@tanstack/react-query'
import { ExternalLink, Film, Heart, ImageIcon, Loader2, PlayCircle, Search, Star, Tv, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useOutletContext, useParams } from 'react-router'
import { toast } from 'sonner'
import Lightbox from 'yet-another-react-lightbox'
import FullscreenPlugin from 'yet-another-react-lightbox/plugins/fullscreen'
import ZoomPlugin from 'yet-another-react-lightbox/plugins/zoom'
import 'yet-another-react-lightbox/styles.css'
import type { AppOutletContext } from '@/components/app-shell/types'
import { MediaRail } from '@/components/media/media-components'
import { ReleaseSearchDialog, type ReleaseSearchError } from '@/components/release-search-dialog'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useFavorites } from '@/contexts/favorites'
import { useMediaDetails, useMediaWatchClickouts } from '@/hooks/use-media-queries'
import { getTmdbLanguage } from '@/i18n'
import { ApiError, searchIndexers } from '@/lib/api'
import { cn } from '@/lib/utils'

function getReleaseSearchInput(media: MediaDetails) {
  const title = media.originalTitle || media.title
  const query = [title, media.releaseYear].filter(Boolean).join(' ')
  const tmdbId = Number(media.ids.tmdb)
  const tvdbId = Number(media.ids.tvdb)
  const imdbId = normalizeImdbId(media.ids.imdb)
  const hasTmdbId = Number.isFinite(tmdbId) && tmdbId > 0
  const hasTvdbId = Number.isFinite(tvdbId) && tvdbId > 0
  const label =
    media.kind === 'tv' && hasTvdbId
      ? `TVDB ${tvdbId}`
      : imdbId
        ? `IMDb ${imdbId}`
        : hasTmdbId
          ? `TMDB ${tmdbId}`
          : query

  return {
    query,
    title,
    aliases: media.aliases,
    year: media.releaseYear,
    kind: media.kind,
    tmdbId: hasTmdbId ? tmdbId : undefined,
    tvdbId: hasTvdbId ? tvdbId : undefined,
    imdbId,
    label,
  }
}

function normalizeImdbId(value: string | null): string | undefined {
  if (!value) return undefined
  return /^tt\d+$/i.test(value) ? value.toLowerCase() : undefined
}

const watchRegionOptions = ['US', 'JP', 'CN', 'HK', 'TW', 'GB', 'CA', 'AU', 'KR', 'TH'] as const

export function MediaDetailPage({ kind }: { kind: MediaKind }) {
  const location = useLocation()
  const { id } = useParams()
  const { setTopbarOverride } = useOutletContext<AppOutletContext>()
  const { i18n, t } = useTranslation()
  const { isFavorite, toggleFavorite } = useFavorites()
  const routeId = Number(id)
  const tmdbLanguage = getTmdbLanguage(i18n.language)
  const [watchRegion, setWatchRegion] = useState('US')
  const mediaDetails = useMediaDetails(kind, routeId, tmdbLanguage, watchRegion)
  const media = mediaDetails.data ?? null
  const [releases, setReleases] = useState<IndexerSearchItem[]>([])
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false)
  const [releaseQuery, setReleaseQuery] = useState('')
  const [releaseError, setReleaseError] = useState<ReleaseSearchError | null>(null)
  const [selectedVideo, setSelectedVideo] = useState<MediaVideo | null>(null)
  const [selectedImageIndex, setSelectedImageIndex] = useState(-1)
  const releaseSearch = useMutation({
    mutationFn: searchIndexers,
    onSuccess: (payload) => {
      setReleases(payload.results)
      setReleaseError(null)
    },
    onError: (error) => {
      setReleases([])
      setReleaseError(getReleaseSearchError(error, t))
    },
  })

  useEffect(() => {
    if (!media) return

    setTopbarOverride({
      pathname: location.pathname,
      title: media.title,
      subtitle: `${media.kind === 'movie' ? t('movie') : t('tv')} / ${media.releaseYear ?? `TMDB ${media.id}`}`,
    })

    return () => setTopbarOverride(null)
  }, [location.pathname, media, setTopbarOverride, t])

  async function handleFindReleases() {
    if (!media) return

    const searchInput = getReleaseSearchInput(media)
    setReleaseQuery(searchInput.label)
    setReleaseDialogOpen(true)
    setReleaseError(null)
    setReleases([])
    releaseSearch.mutate(searchInput)
  }

  async function handleToggleFavorite() {
    if (!media) return

    try {
      await toggleFavorite(media)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('favoriteToggleFailed'))
    }
  }

  if (!Number.isInteger(routeId) || routeId <= 0) {
    return (
      <div className="mx-auto w-full min-w-0 max-w-[1520px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
        <Card className="flex min-h-80 items-center justify-center p-8 text-muted-foreground">
          {t('invalidMediaRoute')}
        </Card>
      </div>
    )
  }

  if (mediaDetails.isLoading) {
    return <MediaDetailSkeleton />
  }

  if (!media) {
    return (
      <div className="mx-auto w-full min-w-0 max-w-[1520px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
        <Card className="flex min-h-80 items-center justify-center p-8 text-muted-foreground">
          {mediaDetails.error instanceof Error ? mediaDetails.error.message : t('mediaNotFound')}
        </Card>
      </div>
    )
  }

  const primaryTrailer = getPrimaryTrailer(media)

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1520px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <section className="overflow-hidden rounded-[28px] bg-[#130d1f] text-white shadow-[0_30px_90px_rgba(33,22,47,0.28)] sm:rounded-[34px]">
        <div className="relative lg:hidden">
          {media.backdropUrl ? (
            <img src={media.backdropUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-42" />
          ) : null}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(19,13,31,.64)_0%,#130d1f_72%)]" />
          <div className="relative p-4 sm:p-5">
            <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3 sm:grid-cols-[128px_minmax(0,1fr)] sm:gap-4">
              <div className="relative overflow-hidden rounded-[18px] shadow-[0_24px_60px_rgba(0,0,0,0.44)] ring-1 ring-white/14">
                {media.posterUrl ? (
                  <img
                    src={media.posterUrl}
                    alt={`${media.title} poster`}
                    className="aspect-[2/3] w-full object-cover"
                  />
                ) : null}
                {primaryTrailer ? (
                  <button
                    type="button"
                    onClick={() => setSelectedVideo(primaryTrailer)}
                    className="absolute top-2 right-2 flex size-11 items-center justify-center rounded-full bg-white/18 text-white shadow-lg backdrop-blur transition hover:scale-105 hover:bg-white/26 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    aria-label={t('trailer')}
                    title={t('trailer')}
                  >
                    <PlayCircle className="size-6" />
                  </button>
                ) : null}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Badge variant="secondary" className="min-h-11 gap-2 bg-white/12 px-3 text-white/82 backdrop-blur">
                    {media.kind === 'movie' ? <Film className="size-3.5" /> : <Tv className="size-3.5" />}
                    {media.kind === 'movie' ? t('movie') : t('tv')}
                  </Badge>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      onClick={() => void handleFindReleases()}
                      size="icon-lg"
                      className="size-11 rounded-xl shadow-lg shadow-primary/25"
                      aria-label="Search releases"
                      title="Search releases"
                    >
                      <Search />
                    </Button>
                    <button
                      type="button"
                      onClick={() => void handleToggleFavorite()}
                      className="flex size-11 items-center justify-center text-white/86 drop-shadow-[0_2px_6px_rgba(0,0,0,0.55)] transition hover:scale-110 hover:text-[#f06595] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f06595] focus-visible:ring-offset-2 focus-visible:ring-offset-[#130d1f]"
                      aria-label={isFavorite(media) ? t('removeFavorite') : t('addFavorite')}
                      title={isFavorite(media) ? t('removeFavorite') : t('addFavorite')}
                    >
                      <Heart className={isFavorite(media) ? 'size-7 fill-[#f06595] text-[#f06595]' : 'size-7'} />
                    </button>
                  </div>
                </div>
                <h1 className="mt-4 text-balance font-semibold text-2xl leading-tight sm:mt-5 sm:text-4xl sm:leading-[0.98]">
                  {media.title}
                </h1>
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-white/72 text-sm">
                  <span>{media.releaseYear}</span>
                  <span className="text-white/28">/</span>
                  <span>{media.runtime ?? t('unknownRuntime')}</span>
                  <span className="text-white/28">/</span>
                  <span className="flex items-center gap-1">
                    <Star className="size-4 fill-[#f6c177] text-[#f6c177]" />
                    {media.rating ? media.rating.toFixed(1) : 'NR'}
                  </span>
                </div>
                <div className="mt-3 text-white/62 text-sm">{media.director ?? t('unknownDirector')}</div>
              </div>
            </div>

            <p className="mt-5 line-clamp-5 text-white/78 text-base leading-7">{media.overview}</p>

            <div className="mt-5 flex flex-wrap gap-2">
              {media.genres.map((genre) => (
                <Badge key={genre} variant="secondary" className="bg-white/12 text-white/76 backdrop-blur">
                  {genre}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <div className="relative hidden lg:block">
          {media.backdropUrl ? (
            <img src={media.backdropUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-54" />
          ) : null}
          <div className="absolute inset-0 bg-[linear-gradient(90deg,#130d1f_0%,rgba(19,13,31,.92)_28%,rgba(19,13,31,.62)_62%,rgba(19,13,31,.88)_100%)]" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#130d1f] via-transparent to-[#130d1f]/20" />

          <div className="relative grid min-h-[560px] grid-cols-[320px_minmax(0,1fr)] items-start gap-8 p-8">
            <div>
              <div className="relative overflow-hidden rounded-[22px] shadow-[0_28px_70px_rgba(0,0,0,0.42)] ring-1 ring-white/14 sm:rounded-[30px]">
                {media.posterUrl ? (
                  <img
                    src={media.posterUrl}
                    alt={`${media.title} poster`}
                    className="aspect-[2/3] w-full object-cover"
                  />
                ) : null}
                {primaryTrailer ? (
                  <button
                    type="button"
                    onClick={() => setSelectedVideo(primaryTrailer)}
                    className="absolute top-4 right-4 flex size-14 items-center justify-center rounded-full bg-white/18 text-white shadow-lg backdrop-blur transition hover:scale-105 hover:bg-white/26 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    aria-label={t('trailer')}
                    title={t('trailer')}
                  >
                    <PlayCircle className="size-8" />
                  </button>
                ) : null}
              </div>
            </div>

            <div className="pt-2">
              <div className="mb-10 flex items-center justify-between gap-6">
                <Badge variant="secondary" className="gap-2 bg-white/12 text-white/82 backdrop-blur">
                  {media.kind === 'movie' ? <Film className="size-3.5" /> : <Tv className="size-3.5" />}
                  {media.kind === 'movie' ? t('movie') : t('tv')}
                </Badge>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    onClick={() => void handleFindReleases()}
                    size="icon-lg"
                    className="size-11 rounded-xl shadow-lg shadow-primary/25"
                    aria-label="Search releases"
                    title="Search releases"
                  >
                    <Search />
                  </Button>
                  <button
                    type="button"
                    onClick={() => void handleToggleFavorite()}
                    className="flex size-11 items-center justify-center text-white/86 drop-shadow-[0_2px_6px_rgba(0,0,0,0.55)] transition hover:scale-110 hover:text-[#f06595] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f06595] focus-visible:ring-offset-2 focus-visible:ring-offset-[#130d1f]"
                    aria-label={isFavorite(media) ? t('removeFavorite') : t('addFavorite')}
                    title={isFavorite(media) ? t('removeFavorite') : t('addFavorite')}
                  >
                    <Heart className={isFavorite(media) ? 'size-7 fill-[#f06595] text-[#f06595]' : 'size-7'} />
                  </button>
                </div>
              </div>
              <h1 className="max-w-4xl text-balance font-semibold text-4xl leading-none sm:text-5xl lg:text-6xl">
                {media.title}
              </h1>
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-white/72 text-sm">
                <span>{media.originalTitle}</span>
                <span className="text-white/28">/</span>
                <span>{media.releaseYear ?? t('unknownYear')}</span>
                <span className="text-white/28">/</span>
                <span>{media.runtime ?? t('unknownRuntime')}</span>
                <span className="text-white/28">/</span>
                <span className="flex items-center gap-1">
                  <Star className="size-4 fill-[#f6c177] text-[#f6c177]" />
                  {media.rating ? media.rating.toFixed(1) : 'NR'}
                </span>
              </div>

              <p className="mt-5 line-clamp-7 max-w-3xl text-white/78 text-base leading-7 sm:mt-6 sm:text-lg sm:leading-8">
                {media.overview}
              </p>

              <Card className="mt-8 grid max-w-3xl grid-cols-4 gap-0 divide-x divide-white/10 bg-white/10 p-1 text-sm text-white backdrop-blur">
                <DetailMetric label={t('director')} value={media.director ?? t('unknown')} />
                <DetailMetric label={t('runtime')} value={media.runtime ?? t('unknown')} />
                <DetailMetric label={t('originalLanguage')} value={media.language ?? t('unknown')} />
                <DetailMetric label={t('rating')} value={media.rating ? media.rating.toFixed(1) : 'NR'} />
              </Card>

              <div className="mt-5 flex flex-wrap gap-2">
                {media.genres.map((genre) => (
                  <Badge key={genre} variant="secondary" className="bg-white/12 text-white/76 backdrop-blur">
                    {genre}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-background px-5 py-7 text-foreground sm:px-8">
          <SectionTitle title={t('cast')} />
          <div className="zme-x-scroll -mx-5 mt-4 flex gap-4 overflow-x-auto px-5 pb-2 sm:-mx-8 sm:px-8">
            {media.cast.length > 0 ? (
              media.cast.map((person) => (
                <Link
                  key={`${person.id}-${person.role}`}
                  to={`/people/${person.id}`}
                  state={{ from: location.pathname }}
                  className="group/person w-[172px] shrink-0"
                >
                  <Card className="aspect-[2/3] gap-0 overflow-hidden bg-[#130d1f] p-0 shadow-[0_18px_42px_rgba(33,22,47,0.14)] transition group-hover/person:-translate-y-1 group-hover/person:shadow-[0_24px_54px_rgba(124,58,237,0.18)]">
                    {person.portraitUrl ? (
                      <img
                        src={person.portraitUrl}
                        alt={person.name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_50%_25%,rgba(139,92,246,.42),transparent_42%),#130d1f] px-4 text-center text-white/62 text-sm">
                        <div className="flex size-16 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/16">
                          <UserRound className="size-8 text-white/70" />
                        </div>
                        <span className="line-clamp-2">{person.name}</span>
                      </div>
                    )}
                  </Card>
                  <CardContent className="mt-3 px-0">
                    <div className="line-clamp-2 font-semibold text-sm leading-tight transition group-hover/person:text-primary">
                      {person.name}
                    </div>
                    <div className="mt-1 line-clamp-1 text-muted-foreground text-xs">{person.role}</div>
                  </CardContent>
                </Link>
              ))
            ) : (
              <Card className="flex min-h-40 min-w-full items-center justify-center text-muted-foreground text-sm">
                {t('noCast')}
              </Card>
            )}
          </div>
        </div>

        {media.images.length > 0 ? (
          <MediaGallery media={media} onSelectImage={setSelectedImageIndex} />
        ) : null}

        <div className="grid gap-8 bg-background px-5 pb-8 text-foreground sm:px-8 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section>
            <SectionTitle title={t('details')} />
            <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
              <InfoField label={t('director')} value={media.director ?? t('unknown')} />
              <InfoField
                label={t('writers')}
                value={media.writers.length > 0 ? media.writers.join(', ') : t('unknown')}
              />
              <InfoField label={t('country')} value={media.country ?? t('unknown')} />
              <InfoField label={t('originalLanguage')} value={media.language ?? t('unknown')} />
              <InfoField label={t('status')} value={media.status ?? t('unknown')} />
              <InfoField label={t('certification')} value={media.releaseInfo?.certification ?? t('unknown')} />
              <InfoField
                label={t('releaseDate')}
                value={media.releaseInfo?.releaseDate ?? media.releaseYear ?? t('unknown')}
              />
              <InfoField
                label={t('homepage')}
                value={
                  media.homepage ? (
                    <a
                      href={media.homepage}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      {t('available')}
                      <ExternalLink className="size-3.5" />
                    </a>
                  ) : (
                    t('unknown')
                  )
                }
              />
              <InfoField label="TMDB" value={media.ids.tmdb} />
              <InfoField label="IMDb" value={media.ids.imdb ?? '-'} />
              <InfoField label="TVDB" value={media.ids.tvdb ?? '-'} />
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              {media.genres.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          </section>

          <aside>
            <WatchProvidersAside
              media={media}
              watchRegion={watchRegion}
              isRefreshing={mediaDetails.isFetching && !mediaDetails.isLoading}
              onWatchRegionChange={setWatchRegion}
            />
          </aside>
        </div>
      </section>

      {media.recommendations.length > 0 || media.similar.length > 0 ? (
        <div className="mt-8 space-y-5 text-foreground">
          {media.recommendations.length > 0 ? (
            <Card className="overflow-hidden p-5 sm:p-6">
              <MediaRail
                title={t('recommendations')}
                subtitle={t('recommendationsSubtitle')}
                items={media.recommendations}
              />
            </Card>
          ) : null}
          {media.similar.length > 0 ? (
            <Card className="overflow-hidden p-5 sm:p-6">
              <MediaRail title={t('similarTitles')} subtitle={t('similarTitlesSubtitle')} items={media.similar} />
            </Card>
          ) : null}
        </div>
      ) : null}

      {releaseDialogOpen ? (
        <ReleaseSearchDialog
          media={media}
          query={releaseQuery}
          items={releases}
          loading={releaseSearch.isPending}
          error={releaseError}
          onClose={() => setReleaseDialogOpen(false)}
          onSearch={() => void handleFindReleases()}
        />
      ) : null}

      <VideoPlayerDialog video={selectedVideo} onClose={() => setSelectedVideo(null)} />
      <MediaImagesLightbox
        images={media.images}
        title={media.title}
        index={selectedImageIndex}
        onClose={() => setSelectedImageIndex(-1)}
      />
    </div>
  )
}

function getPrimaryTrailer(media: MediaDetails) {
  return (
    media.videos.find(
      (video) => video.site.toLowerCase() === 'youtube' && video.type === 'Trailer' && video.official,
    ) ??
    media.videos.find((video) => video.type === 'Trailer') ??
    media.videos[0]
  )
}

function MediaDetailSkeleton() {
  return (
    <div className="mx-auto w-full min-w-0 max-w-[1520px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <section className="overflow-hidden rounded-[28px] bg-[#130d1f] shadow-[0_30px_90px_rgba(33,22,47,0.28)] sm:rounded-[34px]">
        <div className="relative lg:hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(255,255,255,.14),transparent_32%),linear-gradient(180deg,rgba(255,255,255,.08)_0%,#130d1f_72%)]" />
          <div className="relative p-4 sm:p-5">
            <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3 sm:grid-cols-[128px_minmax(0,1fr)] sm:gap-4">
              <Skeleton className="aspect-[2/3] rounded-[18px] bg-white/14 shadow-[0_24px_60px_rgba(0,0,0,0.34)]" />
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <Skeleton className="h-11 w-24 rounded-full bg-white/14" />
                  <div className="flex gap-2">
                    <Skeleton className="size-11 rounded-xl bg-white/14" />
                    <Skeleton className="size-11 rounded-full bg-white/14" />
                  </div>
                </div>
                <Skeleton className="mt-5 h-8 w-4/5 rounded-lg bg-white/16" />
                <Skeleton className="mt-3 h-4 w-3/5 rounded-full bg-white/12" />
                <Skeleton className="mt-3 h-4 w-1/2 rounded-full bg-white/12" />
              </div>
            </div>
            <div className="mt-6 space-y-3">
              <Skeleton className="h-4 w-full rounded-full bg-white/12" />
              <Skeleton className="h-4 w-11/12 rounded-full bg-white/12" />
              <Skeleton className="h-4 w-2/3 rounded-full bg-white/12" />
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-7 w-20 rounded-full bg-white/12" />
              ))}
            </div>
          </div>
        </div>

        <div className="relative hidden min-h-[560px] lg:block">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(255,255,255,.18),transparent_28%),linear-gradient(90deg,#130d1f_0%,rgba(19,13,31,.92)_34%,rgba(19,13,31,.72)_68%,rgba(19,13,31,.88)_100%)]" />
          <div className="relative grid min-h-[560px] grid-cols-[320px_minmax(0,1fr)] items-start gap-8 p-8">
            <Skeleton className="aspect-[2/3] rounded-[30px] bg-white/14 shadow-[0_28px_70px_rgba(0,0,0,0.36)]" />
            <div className="pt-4">
              <div className="flex items-center justify-between gap-4">
                <Skeleton className="h-11 w-28 rounded-full bg-white/14" />
                <div className="flex gap-2">
                  <Skeleton className="size-12 rounded-xl bg-white/14" />
                  <Skeleton className="size-12 rounded-full bg-white/14" />
                </div>
              </div>
              <Skeleton className="mt-10 h-14 w-2/3 rounded-xl bg-white/16" />
              <Skeleton className="mt-5 h-5 w-96 rounded-full bg-white/12" />
              <div className="mt-8 space-y-3">
                <Skeleton className="h-4 w-11/12 rounded-full bg-white/12" />
                <Skeleton className="h-4 w-5/6 rounded-full bg-white/12" />
                <Skeleton className="h-4 w-3/5 rounded-full bg-white/12" />
              </div>
              <div className="mt-8 grid max-w-3xl grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-16 rounded-2xl bg-white/12" />
                ))}
              </div>
              <div className="mt-6 flex gap-2">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-8 w-24 rounded-full bg-white/12" />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-8 bg-background px-5 py-7 text-foreground sm:px-8 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div>
            <Skeleton className="h-7 w-24 rounded-lg" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="space-y-2 rounded-xl border bg-card p-3">
                  <Skeleton className="h-3 w-20 rounded-full" />
                  <Skeleton className="h-5 w-3/4 rounded-full" />
                </div>
              ))}
            </div>
          </div>
          <aside>
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-7 w-36 rounded-lg" />
              <Skeleton className="h-9 w-24 rounded-full" />
            </div>
            <Card className="mt-4 gap-4 p-3">
              {Array.from({ length: 3 }).map((_, groupIndex) => (
                <div key={groupIndex}>
                  <Skeleton className="mb-2 h-3 w-16 rounded-full" />
                  <div className="flex flex-wrap gap-2">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Skeleton key={index} className="size-10 rounded-xl" />
                    ))}
                  </div>
                </div>
              ))}
            </Card>
          </aside>
        </div>
      </section>

      <div className="mt-8 space-y-5">
        {Array.from({ length: 2 }).map((_, railIndex) => (
          <Card key={railIndex} className="overflow-hidden p-5 sm:p-6">
            <Skeleton className="h-7 w-40 rounded-lg" />
            <Skeleton className="mt-2 h-4 w-64 rounded-full" />
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="aspect-[2/3] rounded-xl" />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

function WatchProvidersAside({
  media,
  watchRegion,
  isRefreshing,
  onWatchRegionChange,
}: {
  media: MediaDetails
  watchRegion: string
  isRefreshing: boolean
  onWatchRegionChange: (region: string) => void
}) {
  const { t } = useTranslation()
  const watch = media.watch
  const clickouts = useMediaWatchClickouts(media.kind, media.id, watchRegion, {
    enabled: Boolean(watch && watch.groups.length > 0),
  })
  const providerClickouts = clickouts.data ?? {}
  const refreshing = isRefreshing || clickouts.isFetching

  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <SectionTitle title={t('whereToWatch')} />
        <Select value={watchRegion} onValueChange={(region) => region && onWatchRegionChange(region)}>
          <SelectTrigger className="h-9 w-24 rounded-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {watchRegionOptions.map((region) => (
              <SelectItem key={region} value={region}>
                {region}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {watch && watch.groups.length > 0 ? (
        <Card className="relative mt-4 gap-3 p-3">
          <div className={cn('space-y-3 transition-opacity', refreshing && 'opacity-45')}>
            {watch.groups.map((group) => (
              <div key={group.type}>
                <div className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-[0.08em]">
                  {getWatchGroupLabel(group.type, t)}
                </div>
                <div className="flex flex-wrap gap-2">
                  {group.providers.map((provider) => (
                    <a
                      key={provider.id}
                      href={providerClickouts[normalizeProviderName(provider.name)] ?? provider.url ?? watch.link}
                      target="_blank"
                      rel="noreferrer"
                      className="flex size-10 items-center justify-center rounded-xl bg-muted ring-1 ring-foreground/8 transition hover:-translate-y-0.5 hover:bg-muted/70 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      title={provider.name}
                      aria-label={provider.name}
                    >
                      {provider.logoUrl ? (
                        <img src={provider.logoUrl} alt="" className="size-7 rounded-lg object-cover" loading="lazy" />
                      ) : (
                        <span className="font-semibold text-muted-foreground text-xs">
                          {provider.name.slice(0, 1)}
                        </span>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {refreshing ? (
            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/35 backdrop-blur-[1px]">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : null}
        </Card>
      ) : (
        <Card className="relative mt-4 p-4 text-muted-foreground text-sm">
          {t('noWatchProviders')}
          {refreshing ? (
            <Loader2 className="absolute top-4 right-4 size-4 animate-spin text-muted-foreground" />
          ) : null}
        </Card>
      )}
    </section>
  )
}

function getWatchGroupLabel(type: MediaWatchProviderGroupType, t: (key: string) => string) {
  return t(type)
}

function normalizeProviderName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function MediaGallery({ media, onSelectImage }: { media: MediaDetails; onSelectImage: (index: number) => void }) {
  const { t } = useTranslation()
  const [featuredImage, ...images] = media.images
  if (!featuredImage) return null

  return (
    <section className="bg-background px-5 py-7 text-foreground sm:px-8">
      <SectionTitle title={t('mediaImages')} />
      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <button
          type="button"
          onClick={() => onSelectImage(0)}
          className="group/image relative min-h-56 overflow-hidden rounded-2xl bg-card text-left ring-1 ring-foreground/10 transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <img src={featuredImage.url} alt="" loading="lazy" className="h-full min-h-56 w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/52 via-black/8 to-transparent opacity-90" />
          <div className="absolute right-3 bottom-3 rounded-full bg-white/16 px-3 py-1.5 text-white text-xs backdrop-blur">
            {featuredImage.type}
          </div>
          <ImageIcon className="absolute top-3 right-3 size-5 text-white drop-shadow" />
        </button>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2">
          {images.slice(0, 6).map((image, index) => (
            <button
              key={`${image.type}-${image.url}`}
              type="button"
              onClick={() => onSelectImage(index + 1)}
              className="group/image relative overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <img
                src={image.url}
                alt=""
                loading="lazy"
                className={cn('w-full object-cover', image.type === 'poster' ? 'aspect-[2/3]' : 'aspect-video')}
              />
              <div className="absolute right-2 bottom-2 rounded-full bg-black/55 px-2 py-1 text-white text-xs backdrop-blur">
                {image.type}
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

function MediaImagesLightbox({
  images,
  title,
  index,
  onClose,
}: {
  images: MediaImage[]
  title: string
  index: number
  onClose: () => void
}) {
  return (
    <Lightbox
      open={index >= 0}
      close={onClose}
      index={index}
      slides={images.map((image) => ({
        src: image.url,
        alt: `${title} ${image.type}`,
        description: image.type,
      }))}
      plugins={[ZoomPlugin, FullscreenPlugin]}
      carousel={{ finite: true }}
    />
  )
}

function VideoPlayerDialog({ video, onClose }: { video: MediaVideo | null; onClose: () => void }) {
  const embedUrl = video ? getVideoEmbedUrl(video) : null

  return (
    <Dialog open={Boolean(video)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-5xl gap-3 overflow-hidden p-3 sm:max-w-5xl">
        {video ? (
          <>
            <DialogHeader className="px-1">
              <DialogTitle className="pr-8">{video.name}</DialogTitle>
              <DialogDescription>
                {video.site} / {video.type}
              </DialogDescription>
            </DialogHeader>
            {embedUrl ? (
              <iframe
                title={video.name}
                src={embedUrl}
                className="aspect-video w-full rounded-lg bg-black"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            ) : (
              <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-lg bg-muted p-6 text-center">
                <p className="text-muted-foreground text-sm">{video.name}</p>
                <a
                  href={video.url}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(buttonVariants({ variant: 'secondary' }), 'rounded-full')}
                >
                  <ExternalLink />
                  {video.site}
                </a>
              </div>
            )}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function getVideoEmbedUrl(video: MediaVideo): string | null {
  const site = video.site.toLowerCase()
  if (site === 'youtube') return `https://www.youtube.com/embed/${encodeURIComponent(video.key)}?autoplay=1`
  if (site === 'vimeo') return `https://player.vimeo.com/video/${encodeURIComponent(video.key)}?autoplay=1`
  return null
}

function InfoField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs uppercase tracking-[0.1em]">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  )
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3">
      <div className="text-white/45 text-xs">{label}</div>
      <div className="mt-1 truncate font-medium text-white/86">{value}</div>
    </div>
  )
}

function SectionTitle({ title }: { title: string }) {
  return <h2 className="font-semibold text-xl">{title}</h2>
}

function getReleaseSearchError(error: unknown, t: (key: string) => string): ReleaseSearchError {
  if (error instanceof ApiError && error.code === 'INDEXER_NOT_CONFIGURED') {
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
