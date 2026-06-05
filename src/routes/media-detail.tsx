import type { IndexerSearchItem, MediaDetails, MediaKind } from '@shared/types'
import { useMutation } from '@tanstack/react-query'
import { Film, Heart, Search, Star, Tv } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useOutletContext, useParams } from 'react-router'
import { toast } from 'sonner'
import type { AppOutletContext } from '@/components/app-shell/types'
import { ReleaseSearchDialog, type ReleaseSearchError } from '@/components/release-search-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useFavorites } from '@/contexts/favorites'
import { useMediaDetails } from '@/hooks/use-media-queries'
import { getTmdbLanguage } from '@/i18n'
import { ApiError, searchIndexers } from '@/lib/api'

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

export function MediaDetailPage({ kind }: { kind: MediaKind }) {
  const location = useLocation()
  const { id } = useParams()
  const { setTopbarOverride } = useOutletContext<AppOutletContext>()
  const { i18n, t } = useTranslation()
  const { isFavorite, toggleFavorite } = useFavorites()
  const routeId = Number(id)
  const tmdbLanguage = getTmdbLanguage(i18n.language)
  const mediaDetails = useMediaDetails(kind, routeId, tmdbLanguage)
  const media = mediaDetails.data ?? null
  const [releases, setReleases] = useState<IndexerSearchItem[]>([])
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false)
  const [releaseQuery, setReleaseQuery] = useState('')
  const [releaseError, setReleaseError] = useState<ReleaseSearchError | null>(null)
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
    return (
      <div className="mx-auto w-full min-w-0 max-w-[1520px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
        <Skeleton className="min-h-[560px] rounded-xl" />
      </div>
    )
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
              <div className="overflow-hidden rounded-[18px] shadow-[0_24px_60px_rgba(0,0,0,0.44)] ring-1 ring-white/14">
                {media.posterUrl ? (
                  <img
                    src={media.posterUrl}
                    alt={`${media.title} poster`}
                    className="aspect-[2/3] w-full object-cover"
                  />
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
              <div className="overflow-hidden rounded-[22px] shadow-[0_28px_70px_rgba(0,0,0,0.42)] ring-1 ring-white/14 sm:rounded-[30px]">
                {media.posterUrl ? (
                  <img
                    src={media.posterUrl}
                    alt={`${media.title} poster`}
                    className="aspect-[2/3] w-full object-cover"
                  />
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
                <article key={`${person.name}-${person.role}`} className="w-[172px] shrink-0">
                  <Card className="gap-0 overflow-hidden p-0 shadow-[0_18px_42px_rgba(33,22,47,0.14)]">
                    {person.portraitUrl ? (
                      <img
                        src={person.portraitUrl}
                        alt={person.name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center px-4 text-center text-white/50 text-sm">
                        {t('noPortrait')}
                      </div>
                    )}
                  </Card>
                  <CardContent className="mt-3 px-0">
                    <div className="line-clamp-2 font-semibold text-sm leading-tight">{person.name}</div>
                    <div className="mt-1 line-clamp-1 text-muted-foreground text-xs">{person.role}</div>
                  </CardContent>
                </article>
              ))
            ) : (
              <Card className="flex min-h-40 min-w-full items-center justify-center text-muted-foreground text-sm">
                {t('noCast')}
              </Card>
            )}
          </div>
        </div>

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
            <SectionTitle title={t('externalIds')} />
            <Card className="mt-4 gap-0 divide-y py-0 text-sm">
              <IdLine label="TMDB" value={media.ids.tmdb} />
              <IdLine label="IMDb" value={media.ids.imdb ?? '-'} />
              <IdLine label="TVDB" value={media.ids.tvdb ?? '-'} />
            </Card>
          </aside>
        </div>
      </section>

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
    </div>
  )
}

function InfoField({ label, value }: { label: string; value: string }) {
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

function IdLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="font-medium">{label}</span>
      <span className="text-muted-foreground">{value}</span>
    </div>
  )
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
