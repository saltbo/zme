import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { MediaRail } from '@/components/media/media-components'
import { useDiscoverMedia, usePopularMedia, useTrendingMedia } from '@/hooks/use-media-queries'
import { getTmdbLanguage } from '@/i18n'

const ANIME_GENRE_ID = 16

export function DiscoverPage() {
  const { i18n, t } = useTranslation()
  const tmdbLanguage = getTmdbLanguage(i18n.language)
  const trending = useTrendingMedia(tmdbLanguage)
  const popularMovies = usePopularMedia('movie', tmdbLanguage)
  const popularSeries = usePopularMedia('tv', tmdbLanguage)
  const anime = useDiscoverMedia({
    kind: 'tv',
    language: tmdbLanguage,
    sortBy: 'popularity.desc',
    genreId: ANIME_GENRE_ID,
    originCountry: 'JP',
  })
  const loading = trending.isLoading || popularMovies.isLoading || popularSeries.isLoading || anime.isLoading

  useEffect(() => {
    const error = trending.error ?? popularMovies.error ?? popularSeries.error ?? anime.error
    if (error) toast.error(error instanceof Error ? error.message : t('discoveryLoadFailed'))
  }, [anime.error, popularMovies.error, popularSeries.error, trending.error, t])

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1680px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <div className="space-y-9">
        <MediaRail
          title={t('trending')}
          subtitle={t('trendingSubtitle')}
          items={trending.data ?? []}
          loading={loading}
        />
        <MediaRail
          title={t('popularMovies')}
          subtitle={t('popularMoviesSubtitle')}
          items={popularMovies.data ?? []}
          loading={loading}
          moreTo="/movies"
        />
        <MediaRail
          title={t('popularSeries')}
          subtitle={t('popularSeriesSubtitle')}
          items={popularSeries.data ?? []}
          loading={loading}
          moreTo="/series"
        />
        <MediaRail
          title={t('popularAnime')}
          subtitle={t('popularAnimeSubtitle')}
          items={anime.data?.pages[0]?.results ?? []}
          loading={loading}
          moreTo="/anime"
        />
      </div>
    </div>
  )
}
