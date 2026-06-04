import type { MediaKind } from '@shared/types'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { FilterBar, MediaWall } from '@/components/media/media-components'
import { useMediaSearch, usePopularMedia } from '@/hooks/use-media-queries'
import { getTmdbLanguage } from '@/i18n'
import { DiscoverPage } from '@/routes/discover'

export function MediaWorkspace({ mode }: { mode: 'discover' | MediaKind }) {
  const { i18n, t } = useTranslation()
  const [searchParams] = useSearchParams()
  const searchQuery = searchParams.get('q')?.trim() ?? ''
  const tmdbLanguage = getTmdbLanguage(i18n.language)
  const hasSearched = searchQuery.length > 0
  const popular = usePopularMedia(mode === 'discover' ? 'movie' : mode, tmdbLanguage, {
    enabled: mode !== 'discover' && !hasSearched,
  })
  const search = useMediaSearch(searchQuery, tmdbLanguage)
  const query = hasSearched ? search : popular
  const media = query.data ?? []
  const visibleMedia = hasSearched ? media.filter((item) => mode === 'discover' || item.kind === mode) : media

  useEffect(() => {
    if (!query.error) return
    toast.error(
      query.error instanceof Error ? query.error.message : hasSearched ? t('searchFailed') : t('mediaLoadFailed'),
    )
  }, [hasSearched, query.error, t])

  if (mode === 'discover' && !hasSearched) {
    return <DiscoverPage />
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1680px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <FilterBar mode={mode} resultCount={visibleMedia.length} />
      <MediaWall items={visibleMedia} loading={query.isLoading} />
    </div>
  )
}
