import type { DownloaderSummary, IndexerSearchItem, MediaDetails, MediaKind, MediaSearchItem } from '@shared/types'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import relativeTime from 'dayjs/plugin/relativeTime'
import {
  AlertTriangle,
  ArrowLeft,
  Bookmark,
  Clapperboard,
  Database,
  Download,
  Film,
  HardDriveDownload,
  Home,
  LoaderCircle,
  RefreshCw,
  Search,
  ServerOff,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Tv,
} from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router'
import { Toaster, toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarBadge, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  Sidebar as SidebarRoot,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getTmdbLanguage, supportedLanguages } from './i18n'
import {
  ApiError,
  createDownload,
  getMediaDetails,
  getPopularMedia,
  getTrendingMedia,
  listDownloaders,
  searchIndexers,
  searchMedia,
} from './lib/api'
import { cn, formatBytes } from './lib/utils'
import { DownloadersPage } from './routes/downloaders'
import { IndexersPage } from './routes/indexers'

dayjs.extend(relativeTime)

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

interface ReleaseSearchError {
  title: string
  description: string
  action: string
  tone: 'configuration' | 'connection' | 'generic'
}

type ReleaseSort = 'seeders' | 'date' | 'size-desc' | 'size-asc'
type ReleaseQuality = 'all' | '2160p' | '1080p' | '720p' | 'other'

export function App() {
  return (
    <BrowserRouter>
      <TooltipProvider>
        <AuthenticatedShell />
        <Toaster richColors />
      </TooltipProvider>
    </BrowserRouter>
  )
}

function AuthenticatedShell() {
  const [topbarOverride, setTopbarOverride] = useState<TopbarOverride | null>(null)

  return (
    <SidebarProvider style={{ '--sidebar-width': '17.5rem' } as CSSProperties}>
      <AppSidebar />
      <SidebarInset className="min-h-dvh min-w-0 basis-0 bg-muted/40 text-foreground">
        <MobileHeader />
        <AppTopbar override={topbarOverride} />
        <Routes>
          <Route path="/" element={<MediaWorkspace mode="discover" />} />
          <Route path="/movies" element={<MediaWorkspace mode="movie" />} />
          <Route path="/movies/:id" element={<MediaDetailPage onTopbarChange={setTopbarOverride} />} />
          <Route path="/series" element={<MediaWorkspace mode="tv" />} />
          <Route path="/series/:id" element={<MediaDetailPage onTopbarChange={setTopbarOverride} />} />
          <Route path="/indexers" element={<IndexersPage />} />
          <Route path="/downloaders" element={<DownloadersPage />} />
        </Routes>
      </SidebarInset>
    </SidebarProvider>
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
    <header className="sticky top-0 z-10 border-b bg-background/90 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1680px] items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {isDetailPage ? (
            <Button
              type="button"
              onClick={() => navigate(-1)}
              variant="outline"
              size="icon-lg"
              className="shrink-0 rounded-full"
              aria-label="Back"
            >
              <ArrowLeft />
            </Button>
          ) : null}
          <div className="min-w-0">
            <h1 className="font-semibold text-2xl leading-none">{pageCopy.title}</h1>
            <p className="mt-1 truncate text-muted-foreground text-sm">{pageCopy.subtitle}</p>
          </div>
        </div>
        <form onSubmit={handleSearch} className="relative hidden w-[min(36vw,420px)] md:block">
          <Search className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground" />
          <Input
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-10 rounded-full bg-background/80 pl-9 shadow-sm"
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
  if (pathname === '/downloaders') {
    return {
      title: t('downloaders'),
      subtitle: t('downloadersSubtitle'),
    }
  }
  if (pathname === '/indexers') {
    return {
      title: t('indexers'),
      subtitle: t('indexersSubtitle'),
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

function AppSidebar() {
  const { t } = useTranslation()

  return (
    <div className="hidden lg:block">
      <SidebarRoot collapsible="offcanvas" className="dark border-sidebar-border border-r">
        <SidebarHeader className="p-5">
          <Link to="/" className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-lg shadow-sidebar-primary/30">
              <Clapperboard className="size-5" />
            </span>
            <div>
              <div className="font-semibold text-xl">ZME</div>
              <div className="text-muted-foreground text-xs">{t('privateDesk')}</div>
            </div>
          </Link>
        </SidebarHeader>

        <SidebarContent className="px-3">
          <SidebarMenu>
            <SidebarLink icon={Home} label={t('discover')} to="/" />
            <SidebarLink icon={Film} label={t('movies')} to="/movies" />
            <SidebarLink icon={Tv} label={t('series')} to="/series" />
            <SidebarLink icon={Download} label={t('requests')} to="/" muted />
            <SidebarLink icon={Database} label={t('indexers')} to="/indexers" />
            <SidebarLink icon={HardDriveDownload} label={t('downloaders')} to="/downloaders" />
          </SidebarMenu>
        </SidebarContent>

        <SidebarFooter className="mt-auto p-3">
          <UserPanel />
        </SidebarFooter>
      </SidebarRoot>
    </div>
  )
}

function UserPanel() {
  const { i18n, t } = useTranslation()
  const currentLanguage = getTmdbLanguage(i18n.language)
  const currentLanguageLabel =
    supportedLanguages.find((language) => language.value === currentLanguage)?.label ?? currentLanguage

  async function handleLanguageChange(language: string) {
    window.localStorage.setItem('zme.language', language)
    await i18n.changeLanguage(language)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton
            size="lg"
            className="h-auto min-h-14 rounded-xl px-3 py-2 text-sidebar-foreground hover:bg-sidebar-accent"
          />
        }
      >
        <Avatar size="lg" className="rounded-lg">
          <AvatarFallback className="rounded-lg bg-sidebar-primary text-sidebar-primary-foreground font-semibold">
            S
          </AvatarFallback>
          <AvatarBadge className="bg-emerald-400" />
        </Avatar>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate font-medium text-sm">saltbo</span>
          <span className="mt-0.5 flex items-center gap-1.5 truncate text-muted-foreground text-xs">
            <ShieldCheck className="size-3.5 shrink-0 text-emerald-300" />
            {t('signedIn')}
          </span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="end"
        sideOffset={8}
        className="dark w-56 border border-sidebar-border bg-sidebar text-sidebar-foreground"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>saltbo</DropdownMenuLabel>
          <DropdownMenuItem>
            <ShieldCheck />
            <span>{t('zpanConnected')}</span>
            <span className="ml-auto size-2 rounded-full bg-emerald-500" aria-hidden />
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Settings />
              <span>{t('language')}</span>
              <span className="ml-auto text-muted-foreground text-xs">{currentLanguageLabel}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="dark border border-sidebar-border bg-sidebar text-sidebar-foreground">
              <DropdownMenuRadioGroup
                value={currentLanguage}
                onValueChange={(value) => void handleLanguageChange(value)}
              >
                {supportedLanguages.map((language) => (
                  <DropdownMenuRadioItem key={language.value} value={language.value}>
                    {language.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
  const location = useLocation()
  const isActive = !muted && location.pathname === to

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<NavLink to={to} />}
        isActive={isActive}
        size="lg"
        tooltip={label}
        className={cn('h-11 rounded-xl', muted && 'opacity-55')}
      >
        <Icon />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function MobileHeader() {
  const { t } = useTranslation()

  return (
    <header className="border-b bg-background/90 px-4 py-3 backdrop-blur lg:hidden">
      <div className="flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Clapperboard className="size-4" />
          </span>
          ZME
        </Link>
        <Badge variant="outline" className="h-8 gap-2">
          <ShieldCheck className="size-4" />
          Private
        </Badge>
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
        cn(buttonVariants({ variant: isActive ? 'default' : 'outline', size: 'lg' }), 'h-10 rounded-full')
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
    <div className="mx-auto w-full min-w-0 max-w-[1680px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
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
    <div className="mx-auto w-full min-w-0 max-w-[1680px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
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
              <div key={`${title}-${key}`} className="w-[190px] shrink-0 sm:w-[210px] 2xl:w-[230px]">
                <Skeleton className="aspect-[2/3] rounded-xl" />
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
          <Card className="flex min-h-64 min-w-full items-center justify-center p-8 text-muted-foreground">
            {t('noMedia')}
          </Card>
        ) : null}
      </div>
    </section>
  )
}

function FilterBar({ mode, resultCount }: { mode: 'discover' | MediaKind; resultCount: number }) {
  const { t } = useTranslation()

  return (
    <div className="mb-5 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <Badge variant="secondary" className="h-8 rounded-full px-3 font-semibold">
          {resultCount} {t('titles')}
        </Badge>
        <span className="text-muted-foreground text-sm">
          {mode === 'discover' ? t('mixedDiscoveryWall') : mode === 'movie' ? t('moviesOnly') : t('seriesOnly')}
        </span>
      </div>
      <div className="zme-x-scroll flex gap-2 overflow-x-auto pb-1">
        <FilterChip
          active
          label={mode === 'discover' ? t('recommended') : mode === 'movie' ? t('latestMovies') : t('latestSeries')}
        />
        <FilterChip label="4K" />
        <FilterChip label="1080p" />
        <FilterChip label={t('subtitles')} />
        <Button type="button" variant="outline" size="lg" className="h-9 shrink-0 rounded-full">
          <SlidersHorizontal data-icon="inline-start" />
          {t('filters')}
        </Button>
      </div>
    </div>
  )
}

function FilterChip({ label, active }: { label: string; active?: boolean }) {
  return (
    <Button
      type="button"
      variant={active ? 'default' : 'outline'}
      size="lg"
      className={cn('h-9 shrink-0 rounded-full', active && 'shadow-md shadow-primary/15')}
    >
      {label}
    </Button>
  )
}

function MediaWall({ items, loading }: { items: MediaSearchItem[]; loading: boolean }) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
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
          <Button
            type="button"
            aria-label="Bookmark"
            variant="secondary"
            size="icon-lg"
            className="absolute top-3 right-3 rounded-full opacity-0 shadow-lg shadow-black/20 backdrop-blur transition group-hover:opacity-100"
          >
            <Bookmark />
          </Button>
          <div className="absolute inset-x-0 bottom-0 p-4 text-white">
            <div className="mb-2 flex items-center gap-2 text-white/72 text-xs">
              <Badge variant="secondary" className="bg-white/14 text-white backdrop-blur">
                {item.kind === 'movie' ? <Film className="size-3" /> : <Tv className="size-3" />}
                {item.kind === 'movie' ? t('movie') : t('tv')}
              </Badge>
              <span>{item.releaseYear ?? t('unknown')}</span>
            </div>
            <h2 className="line-clamp-2 text-balance font-semibold text-xl leading-tight drop-shadow">{item.title}</h2>
          </div>
        </CardContent>
      </Link>
      <CardContent className="px-1 pt-3">
        <div className="flex items-center justify-between gap-2 text-muted-foreground text-sm">
          <span className="line-clamp-1">{item.originalTitle}</span>
          <span className="flex shrink-0 items-center gap-1 font-medium text-foreground">
            <Star className="size-3.5 fill-[#f6c177] text-[#f6c177]" />
            {item.rating ? item.rating.toFixed(1) : 'NR'}
          </span>
        </div>
      </CardContent>
    </Card>
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
  const [releaseQuery, setReleaseQuery] = useState('')
  const [releaseError, setReleaseError] = useState<ReleaseSearchError | null>(null)

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
    setReleaseQuery(releaseQuery)
    setReleaseDialogOpen(true)
    setLoadingReleases(true)
    setReleaseError(null)
    setReleases([])

    try {
      const payload = await searchIndexers(releaseQuery)
      setReleases(payload.results)
    } catch (error) {
      setReleases([])
      setReleaseError(getReleaseSearchError(error, t))
    } finally {
      setLoadingReleases(false)
    }
  }

  if (loadingMedia) {
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
          {mediaError ?? t('mediaNotFound')}
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
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon-lg"
                      className="size-11 rounded-xl bg-white/12 text-white/82 backdrop-blur"
                      aria-label="Request"
                      title="Request"
                    >
                      <Bookmark />
                    </Button>
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
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon-lg"
                    className="size-11 rounded-xl bg-white/12 text-white/82 backdrop-blur"
                    aria-label="Request"
                    title="Request"
                  >
                    <Bookmark />
                  </Button>
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
          loading={loadingReleases}
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

function getReleaseStatus({
  loading,
  error,
  resultCount,
  t,
}: {
  loading: boolean
  error: ReleaseSearchError | null
  resultCount: number
  t: (key: string) => string
}) {
  if (loading) {
    return {
      icon: <LoaderCircle className="size-4 animate-spin" />,
      label: t('searchingIndexers'),
      className: 'bg-primary/10 text-primary',
    }
  }

  if (error) {
    return {
      icon: error.tone === 'configuration' ? <ServerOff className="size-4" /> : <AlertTriangle className="size-4" />,
      label: error.tone === 'configuration' ? t('configurationNeeded') : t('searchUnavailable'),
      className: 'bg-destructive/10 text-destructive',
    }
  }

  return {
    icon: <Database className="size-4" />,
    label: `${resultCount} ${t('results')}`,
    className: resultCount > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
  }
}

function ReleaseStatusPill({
  status,
}: {
  status: {
    icon: ReactNode
    label: string
    className: string
  }
}) {
  return (
    <div
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3 font-medium text-sm',
        status.className,
      )}
    >
      {status.icon}
      <span>{status.label}</span>
    </div>
  )
}

function getReleaseQuality(item: IndexerSearchItem): ReleaseQuality {
  const title = item.title.toLowerCase()

  if (title.includes('2160p') || title.includes('4k') || title.includes('uhd')) return '2160p'
  if (title.includes('1080p')) return '1080p'
  if (title.includes('720p')) return '720p'
  return 'other'
}

function getReleaseIndexers(items: IndexerSearchItem[]) {
  return Array.from(new Set(items.map((item) => item.indexer))).sort((left, right) => left.localeCompare(right))
}

function sortReleases(items: IndexerSearchItem[], sort: ReleaseSort) {
  return [...items].sort((left, right) => {
    if (sort === 'date') {
      return new Date(right.publishDate || 0).getTime() - new Date(left.publishDate || 0).getTime()
    }

    if (sort === 'size-desc') {
      return (right.size || 0) - (left.size || 0)
    }

    if (sort === 'size-asc') {
      return (left.size || 0) - (right.size || 0)
    }

    return (right.seeders || 0) - (left.seeders || 0)
  })
}

function filterReleases({
  items,
  keyword,
  indexer,
  quality,
  sort,
}: {
  items: IndexerSearchItem[]
  keyword: string
  indexer: string
  quality: ReleaseQuality
  sort: ReleaseSort
}) {
  const normalizedKeyword = keyword.trim().toLowerCase()
  const filtered = items.filter((item) => {
    const matchesKeyword =
      normalizedKeyword.length === 0 ||
      item.title.toLowerCase().includes(normalizedKeyword) ||
      item.indexer.toLowerCase().includes(normalizedKeyword)
    const matchesIndexer = indexer === 'all' || item.indexer === indexer
    const matchesQuality = quality === 'all' || getReleaseQuality(item) === quality

    return matchesKeyword && matchesIndexer && matchesQuality
  })

  return sortReleases(filtered, sort)
}

function formatReleaseDate(value: string | null, language: string, t: (key: string) => string) {
  if (!value) return t('unknownDate')

  const publishedAt = dayjs(value)
  if (!publishedAt.isValid()) return t('unknownDate')

  return publishedAt.locale(language === 'zh' ? 'zh-cn' : 'en').fromNow()
}

function getDownloaderLabel(item: DownloaderSummary) {
  const kind =
    item.kind === 'zpan'
      ? 'ZPan'
      : item.kind === 'qbittorrent'
        ? 'qBittorrent'
        : item.kind === 'transmission'
          ? 'Transmission'
          : 'aria2'

  return item.description ? `${kind} · ${item.description}` : kind
}

function ReleaseSearchDialog({
  media,
  query,
  items,
  loading,
  error,
  onClose,
  onSearch,
}: {
  media: MediaSearchItem
  query: string
  items: IndexerSearchItem[]
  loading: boolean
  error: ReleaseSearchError | null
  onClose: () => void
  onSearch: () => void
}) {
  const { t } = useTranslation()
  const contentRef = useRef<HTMLDivElement>(null)
  const [keyword, setKeyword] = useState('')
  const [indexer, setIndexer] = useState('all')
  const [quality, setQuality] = useState<ReleaseQuality>('all')
  const [sort, setSort] = useState<ReleaseSort>('seeders')
  const [downloaders, setDownloaders] = useState<DownloaderSummary[]>([])
  const [loadingDownloaders, setLoadingDownloaders] = useState(false)
  const indexers = getReleaseIndexers(items)
  const indexerItems = [
    { label: t('allIndexers'), value: 'all' },
    ...indexers.map((item) => ({ label: item, value: item })),
  ]
  const qualityItems = [
    { label: t('allQualities'), value: 'all' },
    { label: '2160p / 4K', value: '2160p' },
    { label: '1080p', value: '1080p' },
    { label: '720p', value: '720p' },
    { label: t('otherQuality'), value: 'other' },
  ]
  const sortItems = [
    { label: t('sortBySeeders'), value: 'seeders' },
    { label: t('sortByDate'), value: 'date' },
    { label: t('sortByLargest'), value: 'size-desc' },
    { label: t('sortBySmallest'), value: 'size-asc' },
  ]
  const visibleItems = filterReleases({ items, keyword, indexer, quality, sort })
  const status = getReleaseStatus({ loading, error, resultCount: visibleItems.length, t })
  const hasFilters = keyword.trim().length > 0 || indexer !== 'all' || quality !== 'all'
  const enabledDownloaders = downloaders.filter((item) => item.enabled)

  useEffect(() => {
    let cancelled = false
    setLoadingDownloaders(true)
    listDownloaders()
      .then((payload) => {
        if (!cancelled) setDownloaders(payload.items)
      })
      .catch((downloadersError: unknown) => {
        if (!cancelled) {
          toast.error(downloadersError instanceof Error ? downloadersError.message : t('downloadersLoadFailed'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDownloaders(false)
      })

    return () => {
      cancelled = true
    }
  }, [t])

  return (
    <Sheet open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent
        ref={contentRef}
        initialFocus={contentRef}
        side="bottom"
        className="mx-auto max-h-[92vh] max-w-6xl gap-0 overflow-hidden rounded-t-xl border bg-background p-0 sm:mb-4 sm:rounded-xl"
      >
        <SheetHeader className="border-b bg-card py-3 pr-14 pl-4 sm:pr-16 sm:pl-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Database />
              </div>
              <div className="min-w-0">
                <SheetTitle className="truncate text-base">{media.title}</SheetTitle>
                <SheetDescription className="truncate text-xs">
                  {t('indexerSearch')} · {query}
                </SheetDescription>
              </div>
            </div>
            <ReleaseStatusPill status={status} />
          </div>
        </SheetHeader>

        <div className="border-b bg-muted/30 px-4 py-3 sm:px-5">
          <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_150px_130px_160px_auto] lg:items-center">
            <div className="relative min-w-0">
              <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-4 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder={t('filterReleases')}
                className="pl-8"
              />
            </div>

            <Select items={indexerItems} value={indexer} onValueChange={(value) => setIndexer(value || 'all')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('allIndexers')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">{t('allIndexers')}</SelectItem>
                  {indexers.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>

            <Select
              items={qualityItems}
              value={quality}
              onValueChange={(value) => setQuality((value || 'all') as ReleaseQuality)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('allQualities')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">{t('allQualities')}</SelectItem>
                  <SelectItem value="2160p">2160p / 4K</SelectItem>
                  <SelectItem value="1080p">1080p</SelectItem>
                  <SelectItem value="720p">720p</SelectItem>
                  <SelectItem value="other">{t('otherQuality')}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>

            <Select
              items={sortItems}
              value={sort}
              onValueChange={(value) => setSort((value || 'seeders') as ReleaseSort)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('sortReleases')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="seeders">{t('sortBySeeders')}</SelectItem>
                  <SelectItem value="date">{t('sortByDate')}</SelectItem>
                  <SelectItem value="size-desc">{t('sortByLargest')}</SelectItem>
                  <SelectItem value="size-asc">{t('sortBySmallest')}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>

            <Button
              type="button"
              onClick={onSearch}
              variant={error ? 'default' : 'outline'}
              className="lg:justify-self-end"
            >
              {loading ? (
                <LoaderCircle data-icon="inline-start" className="animate-spin" />
              ) : (
                <RefreshCw data-icon="inline-start" />
              )}
              {error ? t('retrySearch') : t('searchAgain')}
            </Button>
          </div>
          {!loading && !error ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
              <SlidersHorizontal className="size-3.5" />
              <span>{t('showingReleases', { shown: visibleItems.length, total: items.length })}</span>
              {hasFilters ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    setKeyword('')
                    setIndexer('all')
                    setQuality('all')
                  }}
                >
                  {t('clearFilters')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="max-h-[68vh] overflow-auto p-4 sm:p-5">
          <ReleasePanel
            items={visibleItems}
            loading={loading}
            error={error}
            onRetry={onSearch}
            filtered={hasFilters}
            downloaders={enabledDownloaders}
            loadingDownloaders={loadingDownloaders}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}

function ReleasePanel({
  downloaders,
  items,
  loading,
  loadingDownloaders,
  error,
  onRetry,
  filtered,
}: {
  downloaders: DownloaderSummary[]
  items: IndexerSearchItem[]
  loading: boolean
  loadingDownloaders: boolean
  error: ReleaseSearchError | null
  onRetry: () => void
  filtered: boolean
}) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <div className="flex flex-col gap-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
        {releaseSkeletonKeys.map((key) => (
          <Card key={key} className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_180px] sm:items-center">
            <CardContent className="px-0">
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="mt-3 h-3 w-1/2" />
              <div className="mt-4 flex gap-2">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
            </CardContent>
            <Skeleton className="h-11 rounded-lg" />
          </Card>
        ))}
      </div>
    )
  }

  if (error) {
    const Icon = error.tone === 'configuration' ? ServerOff : AlertTriangle
    return (
      <Alert
        variant={error.tone === 'generic' ? 'default' : 'destructive'}
        className="min-h-64 items-start rounded-xl p-5 animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
      >
        <Icon className="mt-0.5" />
        <AlertTitle className="text-base">{error.title}</AlertTitle>
        <AlertDescription className="max-w-2xl">{error.description}</AlertDescription>
        <div className="col-start-2 mt-4">
          <Button
            type="button"
            onClick={onRetry}
            size="sm"
            variant={error.tone === 'generic' ? 'outline' : 'destructive'}
          >
            <RefreshCw data-icon="inline-start" />
            {error.action}
          </Button>
        </div>
      </Alert>
    )
  }

  if (items.length === 0) {
    return (
      <Card className="flex min-h-64 items-center justify-center p-6 text-center animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
        <CardContent className="flex max-w-md flex-col items-center px-0">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Search className="size-5" />
          </div>
          <h3 className="mt-4 font-semibold">{filtered ? t('noFilteredReleasesTitle') : t('noReleasesTitle')}</h3>
          <p className="mt-2 text-muted-foreground text-sm">{filtered ? t('noFilteredReleases') : t('noReleases')}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
      {items.map((item) => (
        <ReleaseRow key={item.id} item={item} downloaders={downloaders} loadingDownloaders={loadingDownloaders} />
      ))}
    </div>
  )
}

function ReleaseRow({
  downloaders,
  item,
  loadingDownloaders,
}: {
  downloaders: DownloaderSummary[]
  item: IndexerSearchItem
  loadingDownloaders: boolean
}) {
  const { i18n, t } = useTranslation()
  const [submittingDownloaderId, setSubmittingDownloaderId] = useState<string | null>(null)
  const uri = item.magnetUrl || item.downloadUrl
  const title = item.fileName || item.title

  async function handleDownload(downloaderId: string) {
    if (!uri) {
      toast.error(t('releaseMissingUrl'))
      return
    }

    setSubmittingDownloaderId(downloaderId)
    try {
      await createDownload({
        downloaderId,
        uri,
        title,
      })
      toast.success(t('downloadSubmitted'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('downloadSubmitFailed'))
    } finally {
      setSubmittingDownloaderId(null)
    }
  }

  const submitting = Boolean(submittingDownloaderId)
  const disabled = !uri || loadingDownloaders || downloaders.length === 0 || submitting

  return (
    <Card className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_180px] sm:items-center">
      <CardContent className="min-w-0 px-0">
        <div className="mb-2 flex flex-wrap gap-2">
          <Badge variant="secondary">{item.indexer}</Badge>
          <Badge variant="outline">
            {item.seeders ?? 0} {t('seeders')}
          </Badge>
          <Badge variant="outline">
            {item.leechers ?? 0} {t('leechers')}
          </Badge>
          {item.protocol ? <Badge variant="outline">{item.protocol}</Badge> : null}
          {item.indexerFlags.map((flag) => (
            <Badge key={flag} variant="secondary">
              {flag}
            </Badge>
          ))}
        </div>
        <h3 className="line-clamp-2 font-semibold text-sm leading-5">{title}</h3>
        <div className="mt-2 flex flex-wrap gap-3 text-muted-foreground text-xs">
          <span>{formatBytes(item.size)}</span>
          <span>{item.files !== null ? t('filesCount', { count: item.files }) : t('unknownFiles')}</span>
          <span>{formatReleaseDate(item.publishDate, i18n.language, t)}</span>
          {item.categories.length > 0 ? <span>{item.categories.slice(0, 2).join(' / ')}</span> : null}
          <span>{item.infoHash ? t('magnetReady') : t('torrentUrl')}</span>
          {item.infoUrl ? (
            <a
              className="font-medium text-primary hover:underline"
              href={item.infoUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t('sourcePage')}
            </a>
          ) : null}
        </div>
      </CardContent>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" size="lg" className="h-11" disabled={disabled} />}>
          {submitting ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" />
          ) : (
            <Download data-icon="inline-start" />
          )}
          {loadingDownloaders
            ? t('loadingDownloaders')
            : downloaders.length === 0
              ? t('noDownloadersAvailable')
              : t('downloadTo')}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('chooseDownloader')}</DropdownMenuLabel>
            {downloaders.map((downloader) => (
              <DropdownMenuItem key={downloader.id} onClick={() => void handleDownload(downloader.id)}>
                <HardDriveDownload />
                <span className="truncate">{getDownloaderLabel(downloader)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </Card>
  )
}
