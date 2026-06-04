import type { IndexerSearchItem, MediaDetails, MediaKind, MediaSearchItem } from '@shared/types'
import {
  ArrowLeft,
  ArrowUpRight,
  Bookmark,
  Clapperboard,
  Download,
  Film,
  Home,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Tv,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router'
import { Toaster, toast } from 'sonner'
import { getTmdbLanguage, type SupportedLanguage, supportedLanguages } from './i18n'
import {
  getMediaDetails,
  getPopularMedia,
  getTrendingMedia,
  getZpanSaveUrl,
  searchIndexers,
  searchMedia,
} from './lib/api'
import { cn, formatBytes } from './lib/utils'

const mediaSkeletonKeys = [
  'media-skeleton-1',
  'media-skeleton-2',
  'media-skeleton-3',
  'media-skeleton-4',
  'media-skeleton-5',
  'media-skeleton-6',
]
const releaseSkeletonKeys = ['release-skeleton-1', 'release-skeleton-2', 'release-skeleton-3', 'release-skeleton-4']

interface TopbarOverride {
  pathname: string
  title: string
  subtitle: string
}

export function App() {
  return (
    <BrowserRouter>
      <AuthenticatedShell />
      <Toaster richColors />
    </BrowserRouter>
  )
}

function AuthenticatedShell() {
  const [topbarOverride, setTopbarOverride] = useState<TopbarOverride | null>(null)

  return (
    <main className="min-h-dvh bg-[#f3f0f7] text-[#191420]">
      <Sidebar />
      <div className="min-h-dvh lg:pl-[280px]">
        <MobileHeader />
        <AppTopbar override={topbarOverride} />
        <Routes>
          <Route path="/" element={<MediaWorkspace mode="discover" />} />
          <Route path="/movies" element={<MediaWorkspace mode="movie" />} />
          <Route path="/movies/:id" element={<MediaDetailPage onTopbarChange={setTopbarOverride} />} />
          <Route path="/series" element={<MediaWorkspace mode="tv" />} />
          <Route path="/series/:id" element={<MediaDetailPage onTopbarChange={setTopbarOverride} />} />
        </Routes>
      </div>
    </main>
  )
}

function AppTopbar({ override }: { override: TopbarOverride | null }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const pageCopy =
    override?.pathname === location.pathname ? override : getTopbarCopy(location.pathname, location.state, t)
  const isDetailPage = Boolean(getRouteMedia(location.pathname))
  const [searchValue, setSearchValue] = useState('')

  function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = searchValue.trim()
    if (!query) return

    navigate(`/?q=${encodeURIComponent(query)}`)
  }

  return (
    <header className="sticky top-0 z-10 border-[#ded6ea] border-b bg-[#f3f0f7]/92 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1680px] items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {isDetailPage ? (
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[#d8cfe6] bg-white/80 text-[#5d506f] shadow-sm transition hover:bg-white"
              aria-label="Back"
            >
              <ArrowLeft className="size-4" />
            </button>
          ) : null}
          <div className="min-w-0">
            <h1 className="font-semibold text-2xl text-[#21162f] leading-none">{pageCopy.title}</h1>
            <p className="mt-1 truncate text-[#685b78] text-sm">{pageCopy.subtitle}</p>
          </div>
        </div>
        <form
          onSubmit={handleSearch}
          className="hidden h-10 w-[min(36vw,420px)] items-center gap-2 rounded-full border border-[#d8cfe6] bg-white/82 px-3 text-[#21162f] shadow-sm transition focus-within:border-[#8b5cf6] focus-within:bg-white md:flex"
        >
          <Search className="size-4 shrink-0 text-[#6d3fd1]" />
          <input
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder={t('searchPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#8a7b9c]"
          />
        </form>
      </div>
    </header>
  )
}

function getTopbarCopy(pathname: string, state: unknown, t: (key: string) => string) {
  const routeMedia = getRouteMedia(pathname)
  if (routeMedia) {
    const stateMedia = getStateMedia(state, routeMedia)
    return {
      title: stateMedia?.title ?? (routeMedia.kind === 'movie' ? t('movie') : t('tv')),
      subtitle: stateMedia?.releaseYear
        ? `${routeMedia.kind === 'movie' ? t('movie') : t('tv')} / ${stateMedia.releaseYear}`
        : `${routeMedia.kind === 'movie' ? t('movie') : t('tv')} / TMDB ${routeMedia.id}`,
    }
  }
  if (pathname === '/movies') {
    return {
      title: t('movies'),
      subtitle: t('moviesSubtitle'),
    }
  }
  if (pathname === '/series') {
    return {
      title: t('series'),
      subtitle: t('seriesSubtitle'),
    }
  }
  return {
    title: t('discover'),
    subtitle: t('discoverSubtitle'),
  }
}

function getRouteMedia(pathname: string): { kind: MediaKind; id: number } | undefined {
  const movieMatch = pathname.match(/^\/movies\/(\d+)$/)
  if (movieMatch) {
    return { kind: 'movie', id: Number(movieMatch[1]) }
  }

  const seriesMatch = pathname.match(/^\/series\/(\d+)$/)
  if (seriesMatch) {
    return { kind: 'tv', id: Number(seriesMatch[1]) }
  }

  return undefined
}

function getStateMedia(state: unknown, routeMedia: { kind: MediaKind; id: number }): MediaSearchItem | undefined {
  if (!state || typeof state !== 'object' || !('media' in state)) return undefined

  const media = (state as { media?: MediaSearchItem }).media
  if (media?.kind !== routeMedia.kind || media.id !== routeMedia.id) return undefined

  return media
}

function Sidebar() {
  const { t } = useTranslation()

  return (
    <aside className="fixed inset-y-0 left-0 hidden w-[280px] border-[#d9d1e6] border-r bg-[#21162f] p-5 text-white lg:flex lg:flex-col">
      <Link to="/" className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-[#8b5cf6] shadow-lg shadow-[#8b5cf6]/30">
          <Clapperboard className="size-5" />
        </span>
        <div>
          <div className="font-semibold text-xl">ZME</div>
          <div className="text-[#c8bddc] text-xs">{t('privateDesk')}</div>
        </div>
      </Link>

      <nav className="mt-8 space-y-1">
        <SidebarLink icon={Home} label={t('discover')} to="/" />
        <SidebarLink icon={Film} label={t('movies')} to="/movies" />
        <SidebarLink icon={Tv} label={t('series')} to="/series" />
        <SidebarLink icon={Download} label={t('requests')} to="/" muted />
        <SidebarLink icon={Settings} label={t('sources')} to="/" muted />
      </nav>

      <div className="mt-auto rounded-2xl border border-white/10 bg-white/[0.06] p-4">
        <div className="flex items-center gap-2 text-[#c8bddc] text-xs uppercase tracking-[0.12em]">
          <ShieldCheck className="size-4 text-[#8ee0c6]" />
          {t('signedIn')}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-[#f6c177] font-semibold text-[#21162f]">
            S
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium text-sm">saltbo</div>
            <div className="truncate text-[#c8bddc] text-xs">{t('zpanConnected')}</div>
          </div>
        </div>
        <LanguageMenu />
      </div>
    </aside>
  )
}

function LanguageMenu() {
  const { i18n, t } = useTranslation()
  const currentLanguage = getTmdbLanguage(i18n.language)

  async function handleLanguageChange(language: SupportedLanguage) {
    window.localStorage.setItem('zme.language', language)
    await i18n.changeLanguage(language)
  }

  return (
    <label className="mt-4 block">
      <span className="mb-1 block text-[#c8bddc] text-xs">{t('language')}</span>
      <select
        value={currentLanguage}
        onChange={(event) => void handleLanguageChange(event.target.value as SupportedLanguage)}
        className="h-9 w-full rounded-xl border border-white/10 bg-[#2d213c] px-3 text-white text-sm outline-none"
      >
        {supportedLanguages.map((language) => (
          <option key={language.value} value={language.value}>
            {language.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function SidebarLink({
  icon: Icon,
  label,
  to,
  muted,
}: {
  icon: typeof Home
  label: string
  to: string
  muted?: boolean
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex h-11 items-center gap-3 rounded-xl px-3 text-sm transition',
          isActive && !muted ? 'bg-white text-[#21162f]' : 'text-[#d9cdec] hover:bg-white/10 hover:text-white',
          muted ? 'opacity-55' : '',
        )
      }
    >
      <Icon className="size-4" />
      {label}
    </NavLink>
  )
}

function MobileHeader() {
  const { t } = useTranslation()

  return (
    <header className="border-[#d9d1e6] border-b bg-[#f3f0f7]/90 px-4 py-3 backdrop-blur lg:hidden">
      <div className="flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span className="flex size-9 items-center justify-center rounded-xl bg-[#8b5cf6] text-white">
            <Clapperboard className="size-4" />
          </span>
          ZME
        </Link>
        <div className="flex items-center gap-2 text-[#6d5d7f] text-sm">
          <ShieldCheck className="size-4" />
          Private
        </div>
      </div>
      <nav className="mt-3 grid grid-cols-3 gap-2">
        <MobileNavLink label={t('discover')} to="/" />
        <MobileNavLink label={t('movies')} to="/movies" />
        <MobileNavLink label={t('series')} to="/series" />
      </nav>
    </header>
  )
}

function MobileNavLink({ label, to }: { label: string; to: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex h-10 items-center justify-center rounded-full border text-sm',
          isActive ? 'border-[#8b5cf6] bg-[#8b5cf6] text-white' : 'border-[#d9d1e6] bg-white text-[#5d506f]',
        )
      }
    >
      {label}
    </NavLink>
  )
}

function MediaWorkspace({ mode }: { mode: 'discover' | MediaKind }) {
  const { i18n, t } = useTranslation()
  const [searchParams] = useSearchParams()
  const [media, setMedia] = useState<MediaSearchItem[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [loadingMedia, setLoadingMedia] = useState(false)
  const searchQuery = searchParams.get('q')?.trim() ?? ''
  const tmdbLanguage = getTmdbLanguage(i18n.language)

  const visibleMedia = hasSearched ? media.filter((item) => mode === 'discover' || item.kind === mode) : media

  useEffect(() => {
    if (!searchQuery) {
      if (mode === 'discover') return

      setHasSearched(false)
      setLoadingMedia(true)
      getPopularMedia(mode, tmdbLanguage)
        .then((payload) => setMedia(payload.results))
        .catch((error: unknown) => toast.error(error instanceof Error ? error.message : t('mediaLoadFailed')))
        .finally(() => setLoadingMedia(false))
      return
    }

    setLoadingMedia(true)
    setHasSearched(true)

    searchMedia(searchQuery, tmdbLanguage)
      .then((payload) => setMedia(payload.results))
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : t('searchFailed')))
      .finally(() => setLoadingMedia(false))
  }, [mode, searchQuery, tmdbLanguage, t])

  if (mode === 'discover' && !hasSearched) {
    return <DiscoverPage />
  }

  return (
    <div className="mx-auto max-w-[1680px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <FilterBar mode={mode} resultCount={visibleMedia.length} />
      <MediaWall items={visibleMedia} loading={loadingMedia} />
    </div>
  )
}

function DiscoverPage() {
  const { i18n, t } = useTranslation()
  const [trending, setTrending] = useState<MediaSearchItem[]>([])
  const [popularMovies, setPopularMovies] = useState<MediaSearchItem[]>([])
  const [popularSeries, setPopularSeries] = useState<MediaSearchItem[]>([])
  const [loading, setLoading] = useState(true)

  const tmdbLanguage = getTmdbLanguage(i18n.language)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      getTrendingMedia(tmdbLanguage),
      getPopularMedia('movie', tmdbLanguage),
      getPopularMedia('tv', tmdbLanguage),
    ])
      .then(([trendingPayload, moviesPayload, seriesPayload]) => {
        setTrending(trendingPayload.results)
        setPopularMovies(moviesPayload.results)
        setPopularSeries(seriesPayload.results)
      })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : t('discoveryLoadFailed')))
      .finally(() => setLoading(false))
  }, [tmdbLanguage, t])

  return (
    <div className="mx-auto max-w-[1680px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <div className="space-y-9">
        <MediaRail title={t('trending')} subtitle={t('trendingSubtitle')} items={trending} loading={loading} />
        <MediaRail
          title={t('popularMovies')}
          subtitle={t('popularMoviesSubtitle')}
          items={popularMovies}
          loading={loading}
          moreTo="/movies"
        />
        <MediaRail
          title={t('popularSeries')}
          subtitle={t('popularSeriesSubtitle')}
          items={popularSeries}
          loading={loading}
          moreTo="/series"
        />
      </div>
    </div>
  )
}

function MediaRail({
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
        <div>
          <h2 className="font-semibold text-[#21162f] text-xl">{title}</h2>
          <p className="mt-1 text-[#76678d] text-sm">{subtitle}</p>
        </div>
        {moreTo ? (
          <Link
            to={moreTo}
            className="shrink-0 rounded-full bg-white px-3 py-1.5 font-medium text-[#6d3fd1] text-sm shadow-sm"
          >
            {t('viewAll')}
          </Link>
        ) : null}
      </div>
      <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {loading
          ? mediaSkeletonKeys.map((key) => (
              <div key={`${title}-${key}`} className="w-[190px] shrink-0 sm:w-[210px] 2xl:w-[230px]">
                <div className="aspect-[2/3] animate-pulse rounded-[28px] bg-[#ddd4ea]" />
              </div>
            ))
          : items.map((item) => (
              <div
                key={`rail-${title}-${item.kind}-${item.id}`}
                className="w-[190px] shrink-0 sm:w-[210px] 2xl:w-[230px]"
              >
                <MediaCard item={item} />
              </div>
            ))}
        {!loading && items.length === 0 ? (
          <div className="flex min-h-64 min-w-full items-center justify-center rounded-3xl border border-[#ded6ea] bg-white p-8 text-[#76678d]">
            {t('noMedia')}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function FilterBar({ mode, resultCount }: { mode: 'discover' | MediaKind; resultCount: number }) {
  const { t } = useTranslation()

  return (
    <div className="mb-5 flex flex-col gap-3 border-[#d9d1e6] border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="rounded-full bg-white px-3 py-1.5 font-semibold text-[#21162f] text-sm shadow-sm">
          {resultCount} {t('titles')}
        </span>
        <span className="text-[#76678d] text-sm">
          {mode === 'discover' ? t('mixedDiscoveryWall') : mode === 'movie' ? t('moviesOnly') : t('seriesOnly')}
        </span>
      </div>
      <div className="flex gap-2 overflow-x-auto">
        <FilterChip
          active
          label={mode === 'discover' ? t('recommended') : mode === 'movie' ? t('latestMovies') : t('latestSeries')}
        />
        <FilterChip label="4K" />
        <FilterChip label="1080p" />
        <FilterChip label={t('subtitles')} />
        <button
          type="button"
          className="flex h-9 shrink-0 items-center gap-2 rounded-full border border-[#d8cfe6] bg-white/70 px-3.5 font-medium text-[#5d506f] text-sm transition hover:bg-white"
        >
          <SlidersHorizontal className="size-4" />
          {t('filters')}
        </button>
      </div>
    </div>
  )
}

function FilterChip({ label, active }: { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'h-9 shrink-0 rounded-full border px-3.5 font-medium text-sm transition',
        active
          ? 'border-[#7c3aed] bg-[#7c3aed] text-white shadow-md shadow-[#7c3aed]/16'
          : 'border-[#d8cfe6] bg-white/70 text-[#5d506f] hover:bg-white',
      )}
    >
      {label}
    </button>
  )
}

function MediaWall({ items, loading }: { items: MediaSearchItem[]; loading: boolean }) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
        {mediaSkeletonKeys.map((key) => (
          <div key={key} className="space-y-3">
            <div className="aspect-[2/3] animate-pulse rounded-[28px] bg-[#ddd4ea]" />
            <div className="mx-1 h-4 w-2/3 animate-pulse rounded bg-[#ddd4ea]" />
            <div className="mx-1 h-3 w-1/2 animate-pulse rounded bg-[#eee7f6]" />
          </div>
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex min-h-80 items-center justify-center rounded-3xl border border-[#ded6ea] bg-white p-8 text-[#76678d]">
        {t('noMatchedMedia')}
      </div>
    )
  }

  return (
    <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
      {items.map((item) => (
        <MediaCard key={`${item.kind}-${item.id}`} item={item} />
      ))}
    </div>
  )
}

function MediaCard({ item }: { item: MediaSearchItem }) {
  const { t } = useTranslation()
  const detailPath = item.kind === 'movie' ? `/movies/${item.id}` : `/series/${item.id}`

  return (
    <article className="group">
      <Link to={detailPath} state={{ media: item }} className="block">
        <div className="relative aspect-[2/3] overflow-hidden rounded-[28px] bg-[#21162f] shadow-[0_18px_38px_rgba(33,22,47,0.18)] ring-1 ring-[#21162f]/10 transition duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_28px_58px_rgba(124,58,237,0.24)]">
          {item.posterUrl ? (
            <img
              src={item.posterUrl}
              alt={`${item.title} poster`}
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[#76678d]">{t('noPoster')}</div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#120c1d] via-[#120c1d]/18 to-transparent opacity-92" />
          <button
            type="button"
            aria-label="Bookmark"
            className="absolute top-3 right-3 flex size-9 items-center justify-center rounded-full bg-white/88 text-[#21162f] opacity-0 shadow-lg shadow-black/20 backdrop-blur transition group-hover:opacity-100 hover:bg-[#f6c177]"
          >
            <Bookmark className="size-4" />
          </button>
          <div className="absolute inset-x-0 bottom-0 p-4 text-white">
            <div className="mb-2 flex items-center gap-2 text-white/72 text-xs">
              <span className="flex items-center gap-1 rounded-full bg-white/14 px-2 py-1 backdrop-blur">
                {item.kind === 'movie' ? <Film className="size-3" /> : <Tv className="size-3" />}
                {item.kind === 'movie' ? t('movie') : t('tv')}
              </span>
              <span>{item.releaseYear ?? t('unknown')}</span>
            </div>
            <h2 className="line-clamp-2 text-balance font-semibold text-xl leading-tight drop-shadow">{item.title}</h2>
          </div>
        </div>
      </Link>
      <div className="px-1 pt-3">
        <div className="flex items-center justify-between gap-2 text-[#76678d] text-sm">
          <span className="line-clamp-1">{item.originalTitle}</span>
          <span className="flex shrink-0 items-center gap-1 font-medium text-[#5d506f]">
            <Star className="size-3.5 fill-[#f6c177] text-[#f6c177]" />
            {item.rating ? item.rating.toFixed(1) : 'NR'}
          </span>
        </div>
      </div>
    </article>
  )
}

function MediaDetailPage({ onTopbarChange }: { onTopbarChange: (override: TopbarOverride | null) => void }) {
  const location = useLocation()
  const { i18n, t } = useTranslation()
  const routeMedia = getRouteMedia(location.pathname)
  const routeKind = routeMedia?.kind
  const routeId = routeMedia?.id
  const tmdbLanguage = getTmdbLanguage(i18n.language)
  const [media, setMedia] = useState<MediaDetails | null>(null)
  const [loadingMedia, setLoadingMedia] = useState(true)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [releases, setReleases] = useState<IndexerSearchItem[]>([])
  const [loadingReleases, setLoadingReleases] = useState(false)
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false)

  useEffect(() => {
    if (!routeKind || !routeId) {
      setMedia(null)
      setMediaError(t('invalidMediaRoute'))
      setLoadingMedia(false)
      return
    }

    setLoadingMedia(true)
    setMediaError(null)
    getMediaDetails(routeKind, routeId, tmdbLanguage)
      .then((payload) => setMedia(payload.item))
      .catch((error: unknown) => {
        setMedia(null)
        setMediaError(error instanceof Error ? error.message : t('unableToLoadMediaDetails'))
      })
      .finally(() => setLoadingMedia(false))
  }, [routeKind, routeId, tmdbLanguage, t])

  useEffect(() => {
    if (!media) return

    onTopbarChange({
      pathname: location.pathname,
      title: media.title,
      subtitle: `${media.kind === 'movie' ? t('movie') : t('tv')} / ${media.releaseYear ?? `TMDB ${media.id}`}`,
    })

    return () => onTopbarChange(null)
  }, [location.pathname, media, onTopbarChange, t])

  async function handleFindReleases() {
    if (!media) return

    const releaseQuery = [media.originalTitle, media.releaseYear].filter(Boolean).join(' ')
    setReleaseDialogOpen(true)
    setLoadingReleases(true)

    try {
      const payload = await searchIndexers(releaseQuery)
      setReleases(payload.results)
    } catch {
      setReleases([])
      toast.error(t('indexerSearchFailed'))
    } finally {
      setLoadingReleases(false)
    }
  }

  if (loadingMedia) {
    return (
      <div className="mx-auto max-w-[1520px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
        <div className="min-h-[560px] animate-pulse rounded-[34px] bg-[#21162f]/18" />
      </div>
    )
  }

  if (!media) {
    return (
      <div className="mx-auto max-w-[1520px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
        <div className="flex min-h-80 items-center justify-center rounded-[34px] border border-[#ded6ea] bg-white p-8 text-[#76678d]">
          {mediaError ?? t('mediaNotFound')}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1520px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <section className="overflow-hidden rounded-[28px] bg-[#130d1f] text-white shadow-[0_30px_90px_rgba(33,22,47,0.28)] sm:rounded-[34px]">
        <div className="relative lg:hidden">
          {media.backdropUrl ? (
            <img src={media.backdropUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-42" />
          ) : null}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(19,13,31,.64)_0%,#130d1f_72%)]" />
          <div className="relative p-5">
            <div className="grid grid-cols-[112px_minmax(0,1fr)] items-start gap-4">
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
                <div className="flex items-start justify-between gap-2">
                  <div className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-white/12 px-3 font-medium text-white/82 text-xs uppercase tracking-[0.12em] backdrop-blur">
                    {media.kind === 'movie' ? <Film className="size-3.5" /> : <Tv className="size-3.5" />}
                    {media.kind === 'movie' ? t('movie') : t('tv')}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleFindReleases()}
                      className="flex size-11 items-center justify-center rounded-2xl bg-[#8b5cf6] text-white shadow-lg shadow-[#8b5cf6]/24 transition active:scale-95"
                      aria-label="Search releases"
                      title="Search releases"
                    >
                      <Search className="size-5" />
                    </button>
                    <button
                      type="button"
                      className="flex size-11 items-center justify-center rounded-2xl bg-white/12 text-white/82 backdrop-blur transition active:scale-95"
                      aria-label="Request"
                      title="Request"
                    >
                      <Bookmark className="size-5" />
                    </button>
                  </div>
                </div>
                <h1 className="mt-5 text-balance font-semibold text-4xl leading-[0.98]">{media.title}</h1>
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
                <span
                  key={genre}
                  className="rounded-full bg-white/12 px-3 py-1.5 font-medium text-white/76 text-xs backdrop-blur"
                >
                  {genre}
                </span>
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
                <div className="inline-flex items-center gap-2 rounded-full bg-white/12 px-3 py-1.5 font-medium text-white/82 text-xs uppercase tracking-[0.12em] backdrop-blur">
                  {media.kind === 'movie' ? <Film className="size-3.5" /> : <Tv className="size-3.5" />}
                  {media.kind === 'movie' ? t('movie') : t('tv')}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleFindReleases()}
                    className="flex size-11 items-center justify-center rounded-2xl bg-[#8b5cf6] text-white shadow-lg shadow-[#8b5cf6]/24 transition hover:bg-[#7c3aed]"
                    aria-label="Search releases"
                    title="Search releases"
                  >
                    <Search className="size-5" />
                  </button>
                  <button
                    type="button"
                    className="flex size-11 items-center justify-center rounded-2xl bg-white/12 text-white/82 backdrop-blur transition hover:bg-white/18"
                    aria-label="Request"
                    title="Request"
                  >
                    <Bookmark className="size-5" />
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

              <div className="mt-8 grid max-w-3xl grid-cols-4 divide-x divide-white/10 rounded-[26px] bg-white/10 p-1 text-sm backdrop-blur">
                <DetailMetric label={t('director')} value={media.director ?? t('unknown')} />
                <DetailMetric label={t('runtime')} value={media.runtime ?? t('unknown')} />
                <DetailMetric label={t('originalLanguage')} value={media.language ?? t('unknown')} />
                <DetailMetric label={t('rating')} value={media.rating ? media.rating.toFixed(1) : 'NR'} />
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {media.genres.map((genre) => (
                  <span
                    key={genre}
                    className="rounded-full bg-white/12 px-3 py-1.5 font-medium text-white/76 text-xs backdrop-blur"
                  >
                    {genre}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-[#f8f5fb] px-5 py-7 text-[#21162f] sm:px-8">
          <SectionTitle title={t('cast')} />
          <div className="-mx-5 mt-4 flex gap-4 overflow-x-auto px-5 pb-2 sm:-mx-8 sm:px-8">
            {media.cast.length > 0 ? (
              media.cast.map((person) => (
                <article key={`${person.name}-${person.role}`} className="w-[172px] shrink-0">
                  <div className="aspect-[3/4] overflow-hidden rounded-[26px] bg-[#21162f] shadow-[0_18px_42px_rgba(33,22,47,0.18)]">
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
                  </div>
                  <div className="mt-3">
                    <div className="line-clamp-2 font-semibold text-sm leading-tight">{person.name}</div>
                    <div className="mt-1 line-clamp-1 text-[#76678d] text-xs">{person.role}</div>
                  </div>
                </article>
              ))
            ) : (
              <div className="flex min-h-40 min-w-full items-center justify-center rounded-2xl border border-[#ded6ea] bg-white text-[#76678d] text-sm">
                {t('noCast')}
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-8 bg-[#f8f5fb] px-5 pb-8 text-[#21162f] sm:px-8 xl:grid-cols-[minmax(0,1fr)_340px]">
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
                <span key={tag} className="rounded-full bg-[#f0e9ff] px-3 py-1.5 font-medium text-[#6d3fd1] text-xs">
                  {tag}
                </span>
              ))}
            </div>
          </section>

          <aside>
            <SectionTitle title={t('externalIds')} />
            <div className="mt-4 divide-y divide-[#ded6ea] text-sm">
              <IdLine label="TMDB" value={media.ids.tmdb} />
              <IdLine label="IMDb" value={media.ids.imdb ?? '-'} />
              <IdLine label="TVDB" value={media.ids.tvdb ?? '-'} />
            </div>
          </aside>
        </div>
      </section>

      {releaseDialogOpen ? (
        <ReleaseSearchDialog
          media={media}
          items={releases}
          loading={loadingReleases}
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
      <div className="text-[#76678d] text-xs uppercase tracking-[0.1em]">{label}</div>
      <div className="mt-1 font-medium text-[#21162f]">{value}</div>
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
  return <h2 className="font-semibold text-[#21162f] text-xl">{title}</h2>
}

function IdLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="font-medium text-[#5d506f]">{label}</span>
      <span className="text-[#76678d]">{value}</span>
    </div>
  )
}

function ReleaseSearchDialog({
  media,
  items,
  loading,
  onClose,
  onSearch,
}: {
  media: MediaSearchItem
  items: IndexerSearchItem[]
  loading: boolean
  onClose: () => void
  onSearch: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-[#120c1d]/62 p-3 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6">
      <section className="max-h-[86vh] w-full overflow-hidden rounded-[28px] bg-[#f8f5fb] shadow-2xl shadow-black/30 sm:max-w-4xl">
        <header className="flex items-start justify-between gap-4 border-[#ded6ea] border-b p-5">
          <div>
            <p className="text-[#76678d] text-xs uppercase tracking-[0.12em]">{t('indexerSearch')}</p>
            <h2 className="mt-1 font-semibold text-2xl text-[#21162f]">{media.title}</h2>
            <p className="mt-1 text-[#685b78] text-sm">{t('compareReleases')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-[#5d506f] shadow-sm"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="flex items-center justify-between gap-3 border-[#ded6ea] border-b px-5 py-3">
          <div className="text-[#76678d] text-sm">
            {items.length} {t('results')}
          </div>
          <button
            type="button"
            onClick={onSearch}
            className="flex h-10 items-center gap-2 rounded-full bg-[#7c3aed] px-4 font-semibold text-sm text-white"
          >
            <Search className="size-4" />
            {t('searchAgain')}
          </button>
        </div>

        <div className="max-h-[58vh] overflow-auto p-5">
          <ReleaseList items={items} loading={loading} />
        </div>
      </section>
    </div>
  )
}

function ReleaseList({ items, loading }: { items: IndexerSearchItem[]; loading: boolean }) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <div className="space-y-3">
        {releaseSkeletonKeys.map((key) => (
          <div key={key} className="rounded-2xl border border-[#ded6ea] bg-white p-4">
            <div className="h-4 w-5/6 animate-pulse rounded bg-[#ddd4ea]" />
            <div className="mt-3 h-3 w-1/2 animate-pulse rounded bg-[#eee7f6]" />
          </div>
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex min-h-48 items-center justify-center rounded-2xl border border-[#ded6ea] bg-white p-6 text-[#76678d] text-sm">
        {t('noReleases')}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <ReleaseRow key={item.id} item={item} />
      ))}
    </div>
  )
}

function ReleaseRow({ item }: { item: IndexerSearchItem }) {
  const { t } = useTranslation()
  const uri = item.magnetUrl || item.downloadUrl

  async function handleSave() {
    if (!uri) {
      toast.error(t('releaseMissingUrl'))
      return
    }

    try {
      const payload = await getZpanSaveUrl(uri)
      window.location.assign(payload.url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('openZpanFailed'))
    }
  }

  return (
    <article className="grid gap-4 rounded-2xl border border-[#ded6ea] bg-white p-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_180px] sm:items-center">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap gap-2">
          <span className="rounded-full bg-[#f0e9ff] px-2.5 py-1 font-medium text-[#6d3fd1] text-xs">
            {item.indexer}
          </span>
          <span className="rounded-full bg-[#e8f8f3] px-2.5 py-1 font-medium text-[#247d69] text-xs">
            {item.seeders ?? 0} {t('seeders')}
          </span>
        </div>
        <h3 className="line-clamp-2 font-semibold text-[#21162f] text-sm leading-5">{item.title}</h3>
        <div className="mt-2 flex flex-wrap gap-3 text-[#76678d] text-xs">
          <span>{formatBytes(item.size)}</span>
          <span>{item.publishDate ? new Date(item.publishDate).getFullYear() : t('unknownDate')}</span>
          <span>{item.infoHash ? t('magnetReady') : t('torrentUrl')}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => void handleSave()}
        className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#7c3aed] px-4 font-semibold text-sm text-white transition hover:bg-[#6d28d9] disabled:cursor-not-allowed disabled:opacity-45"
        disabled={!uri}
      >
        {t('saveToZpan')}
        <ArrowUpRight className="size-4" />
      </button>
    </article>
  )
}
