import type { MediaSeasonSummary } from '@shared/types'
import { CalendarDays, Star, Tv } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useOutletContext, useParams } from 'react-router'
import type { AppOutletContext } from '@/components/app-shell/types'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useSeasonDetails } from '@/hooks/use-media-queries'
import { getTmdbLanguage } from '@/i18n'

interface SeasonRouteState {
  seriesTitle?: string
  season?: MediaSeasonSummary
}

const episodeSkeletonKeys = ['episode-skeleton-1', 'episode-skeleton-2', 'episode-skeleton-3', 'episode-skeleton-4']

export function MediaSeasonDetailPage() {
  const location = useLocation()
  const state = location.state as SeasonRouteState | null
  const { id, seasonNumber } = useParams()
  const { setTopbarOverride } = useOutletContext<AppOutletContext>()
  const { i18n, t } = useTranslation()
  const seriesId = Number(id)
  const routeSeasonNumber = Number(seasonNumber)
  const tmdbLanguage = getTmdbLanguage(i18n.language)
  const seasonDetails = useSeasonDetails(seriesId, routeSeasonNumber, tmdbLanguage)
  const season = seasonDetails.data ?? null
  const heading =
    season?.seasonNumber === 0
      ? t('specialSeason')
      : season?.title || state?.season?.title || t('seasonNumber', { number: routeSeasonNumber })
  const seriesTitle = state?.seriesTitle ?? t('series')

  useEffect(() => {
    if (!Number.isInteger(seriesId) || seriesId <= 0 || !Number.isInteger(routeSeasonNumber) || routeSeasonNumber < 0) {
      return
    }

    setTopbarOverride({
      pathname: location.pathname,
      title: heading,
      subtitle: seriesTitle,
      backTo: `/series/${seriesId}`,
    })

    return () => setTopbarOverride(null)
  }, [heading, location.pathname, routeSeasonNumber, seriesId, seriesTitle, setTopbarOverride])

  if (!Number.isInteger(seriesId) || seriesId <= 0 || !Number.isInteger(routeSeasonNumber) || routeSeasonNumber < 0) {
    return (
      <div className="mx-auto w-full min-w-0 max-w-[1280px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
        <Card className="flex min-h-80 items-center justify-center p-8 text-muted-foreground">
          {t('invalidSeasonRoute')}
        </Card>
      </div>
    )
  }

  if (seasonDetails.isLoading) {
    return <SeasonDetailSkeleton />
  }

  if (!season) {
    return (
      <div className="mx-auto w-full min-w-0 max-w-[1280px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
        <Card className="flex min-h-80 items-center justify-center p-8 text-muted-foreground">
          {seasonDetails.error instanceof Error ? seasonDetails.error.message : t('seasonNotFound')}
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1280px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <section className="overflow-hidden rounded-[28px] bg-[#130d1f] text-white shadow-[0_30px_90px_rgba(33,22,47,0.22)] sm:rounded-[34px]">
        <div className="grid gap-5 p-5 sm:p-7 md:grid-cols-[220px_minmax(0,1fr)]">
          <Card className="aspect-[2/3] gap-0 overflow-hidden bg-white/8 p-0 ring-1 ring-white/12">
            {season.posterUrl ? (
              <img src={season.posterUrl} alt={heading} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-white/62">
                <Tv className="size-12" />
                <span className="line-clamp-2 text-sm">{heading}</span>
              </div>
            )}
          </Card>

          <div className="min-w-0 py-1 md:py-3">
            <Badge variant="secondary" className="gap-2 bg-white/12 text-white/82 backdrop-blur">
              <Tv className="size-3.5" />
              {t('seasons')}
            </Badge>
            <h1 className="mt-5 text-balance font-semibold text-3xl leading-tight sm:text-5xl">{heading}</h1>
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-white/72">
              {season.airDate ? (
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="size-4" />
                  {season.airDate}
                </span>
              ) : null}
              {season.episodeCount !== null ? (
                <>
                  <span className="text-white/28">/</span>
                  <span>{t('episodesCount', { count: season.episodeCount })}</span>
                </>
              ) : null}
              {season.rating !== null ? (
                <>
                  <span className="text-white/28">/</span>
                  <span className="flex items-center gap-1">
                    <Star className="size-4 fill-[#f6c177] text-[#f6c177]" />
                    {season.rating.toFixed(1)}
                  </span>
                </>
              ) : null}
            </div>
            <p className="mt-5 max-w-3xl text-base text-white/78 leading-7">{season.overview || t('unknown')}</p>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold text-xl">{t('episodes')}</h2>
        <div className="mt-4 grid gap-4">
          {season.episodes.length > 0 ? (
            season.episodes.map((episode) => (
              <Card key={episode.id} className="grid gap-0 overflow-hidden p-0 sm:grid-cols-[220px_minmax(0,1fr)]">
                <div className="aspect-video bg-muted sm:aspect-auto">
                  {episode.stillUrl ? (
                    <img src={episode.stillUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      <Tv className="size-9" />
                    </div>
                  )}
                </div>
                <CardContent className="min-w-0 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-muted-foreground text-xs">
                        {t('episodes')} {episode.episodeNumber}
                      </div>
                      <h3 className="mt-1 font-semibold text-lg leading-tight">{episode.title}</h3>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2 text-muted-foreground text-xs">
                      {episode.airDate ? <span>{episode.airDate}</span> : null}
                      {episode.runtime ? <span>{episode.runtime}</span> : null}
                      {episode.rating !== null ? (
                        <span className="inline-flex items-center gap-1">
                          <Star className="size-3.5 fill-[#f6c177] text-[#f6c177]" />
                          {episode.rating.toFixed(1)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {episode.overview ? (
                    <p className="mt-3 line-clamp-3 text-muted-foreground text-sm leading-6">{episode.overview}</p>
                  ) : null}
                </CardContent>
              </Card>
            ))
          ) : (
            <Card className="flex min-h-40 items-center justify-center p-8 text-muted-foreground text-sm">
              {t('noEpisodes')}
            </Card>
          )}
        </div>
      </section>
    </div>
  )
}

function SeasonDetailSkeleton() {
  return (
    <div className="mx-auto w-full min-w-0 max-w-[1280px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <Skeleton className="h-10 w-40 rounded-xl" />
      <section className="mt-4 grid gap-5 rounded-[28px] bg-[#130d1f] p-5 sm:p-7 md:grid-cols-[220px_minmax(0,1fr)]">
        <Skeleton className="aspect-[2/3] rounded-xl bg-white/14" />
        <div className="py-3">
          <Skeleton className="h-8 w-24 rounded-full bg-white/14" />
          <Skeleton className="mt-6 h-12 w-3/5 rounded-xl bg-white/16" />
          <Skeleton className="mt-4 h-4 w-80 rounded-full bg-white/12" />
          <div className="mt-7 space-y-3">
            <Skeleton className="h-4 w-full rounded-full bg-white/12" />
            <Skeleton className="h-4 w-5/6 rounded-full bg-white/12" />
            <Skeleton className="h-4 w-2/3 rounded-full bg-white/12" />
          </div>
        </div>
      </section>
      <div className="mt-8 space-y-4">
        {episodeSkeletonKeys.map((key) => (
          <Skeleton key={key} className="h-44 rounded-xl" />
        ))}
      </div>
    </div>
  )
}
