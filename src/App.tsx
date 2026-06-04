import type { IndexerSearchItem, MediaKind, MediaSearchItem } from '@shared/types'
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
import { useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router'
import { Toaster, toast } from 'sonner'
import { getZpanSaveUrl, searchIndexers, searchMedia } from './lib/api'
import { cn, formatBytes } from './lib/utils'

const libraryItems: MediaSearchItem[] = [
  {
    id: 155,
    kind: 'movie',
    title: 'The Dark Knight',
    originalTitle: 'The Dark Knight',
    overview: 'A city crime saga built around pressure, masks, and impossible choices.',
    posterUrl: 'https://image.tmdb.org/t/p/w342/qJ2tW6WMUDux911r6m7haRef0WH.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w780/hkBaDkMWbLaf8B1lsWsKX7Ew3Xq.jpg',
    releaseYear: '2008',
    rating: 8.5,
  },
  {
    id: 27205,
    kind: 'movie',
    title: 'Inception',
    originalTitle: 'Inception',
    overview: 'A layered heist film where memory, architecture, and time collapse together.',
    posterUrl: 'https://image.tmdb.org/t/p/w342/edv5CZvWj09upOsy2Y6IwDhK8bt.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w780/s3TBrRGB1iav7gFOCNx3H31MoES.jpg',
    releaseYear: '2010',
    rating: 8.4,
  },
  {
    id: 157336,
    kind: 'movie',
    title: 'Interstellar',
    originalTitle: 'Interstellar',
    overview: 'A space odyssey about gravity, family, and the cost of survival.',
    posterUrl: 'https://image.tmdb.org/t/p/w342/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w780/xJHokMbljvjADYdit5fK5VQsXEG.jpg',
    releaseYear: '2014',
    rating: 8.4,
  },
  {
    id: 603,
    kind: 'movie',
    title: 'The Matrix',
    originalTitle: 'The Matrix',
    overview: 'A cyberpunk action landmark with clean release naming across most indexers.',
    posterUrl: 'https://image.tmdb.org/t/p/w342/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w780/icmmSD4vTTDKOq2vvdulafOGw93.jpg',
    releaseYear: '1999',
    rating: 8.2,
  },
  {
    id: 1396,
    kind: 'tv',
    title: 'Breaking Bad',
    originalTitle: 'Breaking Bad',
    overview: 'A controlled descent from ordinary life into empire, consequence, and myth.',
    posterUrl: 'https://image.tmdb.org/t/p/w342/3xnWaLQjelJDDF7LT1WBo6f4BRe.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w780/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg',
    releaseYear: '2008',
    rating: 8.9,
  },
  {
    id: 66732,
    kind: 'tv',
    title: 'Stranger Things',
    originalTitle: 'Stranger Things',
    overview: 'Small-town horror, friendship, and a signal from somewhere underneath.',
    posterUrl: 'https://image.tmdb.org/t/p/w342/uOOtwVbSr4QDjAGIifLDwpb2Pdl.jpg',
    backdropUrl: 'https://image.tmdb.org/t/p/w780/56v2KjBlU4XaOv9rVYEQypROD7P.jpg',
    releaseYear: '2016',
    rating: 8.6,
  },
]

const mockReleases: IndexerSearchItem[] = [
  {
    id: 'demo-1',
    title: 'Interstellar.2014.2160p.UHD.BluRay.REMUX.HEVC.DTS-HD.MA.5.1',
    indexer: 'Private Indexer',
    size: 83_400_000_000,
    seeders: 142,
    leechers: 8,
    publishDate: '2025-10-12T12:00:00.000Z',
    downloadUrl: null,
    magnetUrl: 'magnet:?xt=urn:btih:demo-interstellar-remux',
    infoHash: 'demo-interstellar-remux',
  },
  {
    id: 'demo-2',
    title: 'Interstellar.2014.1080p.BluRay.x265.10bit.AAC',
    indexer: 'Public BT',
    size: 7_900_000_000,
    seeders: 415,
    leechers: 22,
    publishDate: '2025-08-02T12:00:00.000Z',
    downloadUrl: null,
    magnetUrl: 'magnet:?xt=urn:btih:demo-interstellar-1080p',
    infoHash: 'demo-interstellar-1080p',
  },
]

const mediaSkeletonKeys = [
  'media-skeleton-1',
  'media-skeleton-2',
  'media-skeleton-3',
  'media-skeleton-4',
  'media-skeleton-5',
  'media-skeleton-6',
]
const releaseSkeletonKeys = ['release-skeleton-1', 'release-skeleton-2', 'release-skeleton-3', 'release-skeleton-4']

const detailMeta = {
  genres: ['Sci-Fi', 'Adventure', 'Drama'],
  runtime: '2h 49m',
  language: 'English',
  country: 'United States',
  director: 'Christopher Nolan',
  writers: ['Jonathan Nolan', 'Christopher Nolan'],
  cast: [
    {
      name: 'Matthew McConaughey',
      role: 'Cooper',
      portraitUrl: 'https://image.tmdb.org/t/p/w342/wJiGedOCZhwMx9DezY8uwbNxmAY.jpg',
    },
    {
      name: 'Anne Hathaway',
      role: 'Brand',
      portraitUrl: 'https://image.tmdb.org/t/p/w342/tLelKoPNiyJCSEtQTz1FGv4TLGc.jpg',
    },
    {
      name: 'Jessica Chastain',
      role: 'Murph',
      portraitUrl: 'https://image.tmdb.org/t/p/w342/lodMzLKSdrPcBry6TdoDsMN3Vge.jpg',
    },
    {
      name: 'Michael Caine',
      role: 'Professor Brand',
      portraitUrl: 'https://image.tmdb.org/t/p/w342/bVZRMlpjTAO2pJK6v90buFgVbSW.jpg',
    },
  ],
  ids: {
    tmdb: '157336',
    imdb: 'tt0816692',
    tvdb: '-',
  },
  tags: ['IMAX', 'Space', 'Time dilation', 'Family', 'High bitrate recommended'],
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
  return (
    <main className="min-h-dvh bg-[#f3f0f7] text-[#191420]">
      <Sidebar />
      <div className="min-h-dvh lg:pl-[280px]">
        <MobileHeader />
        <AppTopbar />
        <Routes>
          <Route path="/" element={<MediaWorkspace mode="discover" />} />
          <Route path="/movies" element={<MediaWorkspace mode="movie" />} />
          <Route path="/movies/:id" element={<MediaDetailPage />} />
          <Route path="/series" element={<MediaWorkspace mode="tv" />} />
          <Route path="/series/:id" element={<MediaDetailPage />} />
        </Routes>
      </div>
    </main>
  )
}

function AppTopbar() {
  const navigate = useNavigate()
  const location = useLocation()
  const pageCopy = getTopbarCopy(location.pathname)
  const isDetailPage = Boolean(getMediaByPathname(location.pathname))
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
            placeholder="Search movies or series"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#8a7b9c]"
          />
        </form>
      </div>
    </header>
  )
}

function getTopbarCopy(pathname: string) {
  const media = getMediaByPathname(pathname)
  if (media) {
    return {
      title: media.title,
      subtitle: `${media.kind === 'movie' ? 'Movie' : 'Series'} / ${media.releaseYear ?? 'Unknown year'}`,
    }
  }
  if (pathname === '/movies') {
    return {
      title: 'Movies',
      subtitle: 'Browse movie metadata.',
    }
  }
  if (pathname === '/series') {
    return {
      title: 'Series',
      subtitle: 'Browse series metadata.',
    }
  }
  return {
    title: 'Discover',
    subtitle: 'A private overview of recent requests and media worth saving.',
  }
}

function getMediaByPathname(pathname: string): MediaSearchItem | undefined {
  const movieMatch = pathname.match(/^\/movies\/(\d+)$/)
  if (movieMatch) {
    return libraryItems.find((item) => item.kind === 'movie' && item.id === Number(movieMatch[1]))
  }

  const seriesMatch = pathname.match(/^\/series\/(\d+)$/)
  if (seriesMatch) {
    return libraryItems.find((item) => item.kind === 'tv' && item.id === Number(seriesMatch[1]))
  }

  return undefined
}

function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-[280px] border-[#d9d1e6] border-r bg-[#21162f] p-5 text-white lg:flex lg:flex-col">
      <Link to="/" className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-[#8b5cf6] shadow-lg shadow-[#8b5cf6]/30">
          <Clapperboard className="size-5" />
        </span>
        <div>
          <div className="font-semibold text-xl">ZME</div>
          <div className="text-[#c8bddc] text-xs">Private media desk</div>
        </div>
      </Link>

      <nav className="mt-8 space-y-1">
        <SidebarLink icon={Home} label="Discover" to="/" />
        <SidebarLink icon={Film} label="Movies" to="/movies" />
        <SidebarLink icon={Tv} label="Series" to="/series" />
        <SidebarLink icon={Download} label="Requests" to="/" muted />
        <SidebarLink icon={Settings} label="Sources" to="/" muted />
      </nav>

      <div className="mt-auto rounded-2xl border border-white/10 bg-white/[0.06] p-4">
        <div className="flex items-center gap-2 text-[#c8bddc] text-xs uppercase tracking-[0.12em]">
          <ShieldCheck className="size-4 text-[#8ee0c6]" />
          Signed in
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-[#f6c177] font-semibold text-[#21162f]">
            S
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium text-sm">saltbo</div>
            <div className="truncate text-[#c8bddc] text-xs">ZPan connected</div>
          </div>
        </div>
      </div>
    </aside>
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
        <MobileNavLink label="Discover" to="/" />
        <MobileNavLink label="Movies" to="/movies" />
        <MobileNavLink label="Series" to="/series" />
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
  const [searchParams] = useSearchParams()
  const [media, setMedia] = useState<MediaSearchItem[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [loadingMedia, setLoadingMedia] = useState(false)
  const searchQuery = searchParams.get('q')?.trim() ?? ''

  const baseItems = useMemo(() => getBaseItems(mode), [mode])
  const visibleMedia = hasSearched ? media.filter((item) => mode === 'discover' || item.kind === mode) : baseItems

  useEffect(() => {
    if (!searchQuery) return

    setLoadingMedia(true)
    setHasSearched(true)

    searchMedia(searchQuery)
      .then((payload) => setMedia(payload.results))
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : 'Search failed.'))
      .finally(() => setLoadingMedia(false))
  }, [searchQuery])

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
  return (
    <div className="mx-auto max-w-[1680px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <div className="space-y-9">
        <MediaRail
          title="Recent requests"
          subtitle="Continue from recently selected titles"
          items={[libraryItems[2], libraryItems[4], libraryItems[1]].filter(Boolean)}
        />
        <MediaRail
          title="Trending"
          subtitle="Popular across connected metadata sources"
          items={[libraryItems[5], libraryItems[0], libraryItems[3], libraryItems[2]].filter(Boolean)}
        />
        <MediaRail
          title="Movies"
          subtitle="A quick sample from the movie shelf"
          items={libraryItems.filter((item) => item.kind === 'movie')}
          moreTo="/movies"
        />
        <MediaRail
          title="Series"
          subtitle="A quick sample from the series shelf"
          items={libraryItems.filter((item) => item.kind === 'tv')}
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
}: {
  title: string
  subtitle: string
  items: MediaSearchItem[]
  moreTo?: string
}) {
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
            View all
          </Link>
        ) : null}
      </div>
      <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {items.map((item) => (
          <div key={`rail-${title}-${item.kind}-${item.id}`} className="w-[190px] shrink-0 sm:w-[210px] 2xl:w-[230px]">
            <MediaCard item={item} />
          </div>
        ))}
      </div>
    </section>
  )
}

function getBaseItems(mode: 'discover' | MediaKind) {
  if (mode === 'movie') return libraryItems.filter((item) => item.kind === 'movie')
  if (mode === 'tv') return libraryItems.filter((item) => item.kind === 'tv')
  return [libraryItems[2], libraryItems[4], libraryItems[1], libraryItems[5], libraryItems[0], libraryItems[3]].filter(
    Boolean,
  )
}

function FilterBar({ mode, resultCount }: { mode: 'discover' | MediaKind; resultCount: number }) {
  return (
    <div className="mb-5 flex flex-col gap-3 border-[#d9d1e6] border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="rounded-full bg-white px-3 py-1.5 font-semibold text-[#21162f] text-sm shadow-sm">
          {resultCount} titles
        </span>
        <span className="text-[#76678d] text-sm">
          {mode === 'discover' ? 'Mixed discovery wall' : mode === 'movie' ? 'Movies only' : 'Series only'}
        </span>
      </div>
      <div className="flex gap-2 overflow-x-auto">
        <FilterChip
          active
          label={mode === 'discover' ? 'Recommended' : mode === 'movie' ? 'Latest movies' : 'Latest series'}
        />
        <FilterChip label="4K" />
        <FilterChip label="1080p" />
        <FilterChip label="Subtitles" />
        <button
          type="button"
          className="flex h-9 shrink-0 items-center gap-2 rounded-full border border-[#d8cfe6] bg-white/70 px-3.5 font-medium text-[#5d506f] text-sm transition hover:bg-white"
        >
          <SlidersHorizontal className="size-4" />
          Filters
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
        No media matched this view.
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
  const detailPath = item.kind === 'movie' ? `/movies/${item.id}` : `/series/${item.id}`

  return (
    <article className="group">
      <Link to={detailPath} className="block">
        <div className="relative aspect-[2/3] overflow-hidden rounded-[28px] bg-[#21162f] shadow-[0_18px_38px_rgba(33,22,47,0.18)] ring-1 ring-[#21162f]/10 transition duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_28px_58px_rgba(124,58,237,0.24)]">
          {item.posterUrl ? (
            <img
              src={item.posterUrl}
              alt={`${item.title} poster`}
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[#76678d]">No poster</div>
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
                {item.kind === 'movie' ? 'Movie' : 'Series'}
              </span>
              <span>{item.releaseYear ?? 'Unknown'}</span>
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

function MediaDetailPage() {
  const location = useLocation()
  const media = getMediaByPathname(location.pathname) ?? libraryItems[2]
  const [releases, setReleases] = useState<IndexerSearchItem[]>(mockReleases)
  const [loadingReleases, setLoadingReleases] = useState(false)
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false)

  async function handleFindReleases() {
    const releaseQuery = [media.originalTitle, media.releaseYear].filter(Boolean).join(' ')
    setReleaseDialogOpen(true)
    setLoadingReleases(true)

    try {
      const payload = await searchIndexers(releaseQuery)
      setReleases(payload.results.length > 0 ? payload.results : mockReleases)
    } catch {
      setReleases(mockReleases)
    } finally {
      setLoadingReleases(false)
    }
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
                    {media.kind === 'movie' ? 'Movie' : 'Series'}
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
                  <span>{detailMeta.runtime}</span>
                  <span className="text-white/28">/</span>
                  <span className="flex items-center gap-1">
                    <Star className="size-4 fill-[#f6c177] text-[#f6c177]" />
                    {media.rating ? media.rating.toFixed(1) : 'NR'}
                  </span>
                </div>
                <div className="mt-3 text-white/62 text-sm">{detailMeta.director}</div>
              </div>
            </div>

            <p className="mt-5 text-white/78 text-base leading-7">{media.overview}</p>

            <div className="mt-5 flex flex-wrap gap-2">
              {detailMeta.genres.map((genre) => (
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
                  {media.kind === 'movie' ? 'Movie' : 'Series'}
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
                <span>{media.releaseYear}</span>
                <span className="text-white/28">/</span>
                <span>{detailMeta.runtime}</span>
                <span className="text-white/28">/</span>
                <span className="flex items-center gap-1">
                  <Star className="size-4 fill-[#f6c177] text-[#f6c177]" />
                  {media.rating ? media.rating.toFixed(1) : 'NR'}
                </span>
              </div>

              <p className="mt-5 max-w-3xl text-white/78 text-base leading-7 sm:mt-6 sm:text-lg sm:leading-8">
                {media.overview}
              </p>

              <div className="mt-8 grid max-w-3xl grid-cols-4 divide-x divide-white/10 rounded-[26px] bg-white/10 p-1 text-sm backdrop-blur">
                <DetailMetric label="Director" value={detailMeta.director} />
                <DetailMetric label="Runtime" value={detailMeta.runtime} />
                <DetailMetric label="Language" value={detailMeta.language} />
                <DetailMetric label="Rating" value={media.rating ? media.rating.toFixed(1) : 'NR'} />
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {detailMeta.genres.map((genre) => (
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
          <SectionTitle title="Cast" />
          <div className="-mx-5 mt-4 flex gap-4 overflow-x-auto px-5 pb-2 sm:-mx-8 sm:px-8">
            {detailMeta.cast.map((person) => (
              <article key={person.name} className="w-[172px] shrink-0">
                <div className="aspect-[3/4] overflow-hidden rounded-[26px] bg-[#21162f] shadow-[0_18px_42px_rgba(33,22,47,0.18)]">
                  <img
                    src={person.portraitUrl}
                    alt={person.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="mt-3">
                  <div className="line-clamp-2 font-semibold text-sm leading-tight">{person.name}</div>
                  <div className="mt-1 line-clamp-1 text-[#76678d] text-xs">{person.role}</div>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="grid gap-8 bg-[#f8f5fb] px-5 pb-8 text-[#21162f] sm:px-8 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section>
            <SectionTitle title="Details" />
            <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
              <InfoField label="Director" value={detailMeta.director} />
              <InfoField label="Writers" value={detailMeta.writers.join(', ')} />
              <InfoField label="Country" value={detailMeta.country} />
              <InfoField label="Original language" value={detailMeta.language} />
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              {detailMeta.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-[#f0e9ff] px-3 py-1.5 font-medium text-[#6d3fd1] text-xs">
                  {tag}
                </span>
              ))}
            </div>
          </section>

          <aside>
            <SectionTitle title="External IDs" />
            <div className="mt-4 divide-y divide-[#ded6ea] text-sm">
              <IdLine label="TMDB" value={detailMeta.ids.tmdb} />
              <IdLine label="IMDb" value={detailMeta.ids.imdb} />
              <IdLine label="TVDB" value={detailMeta.ids.tvdb} />
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
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-[#120c1d]/62 p-3 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6">
      <section className="max-h-[86vh] w-full overflow-hidden rounded-[28px] bg-[#f8f5fb] shadow-2xl shadow-black/30 sm:max-w-4xl">
        <header className="flex items-start justify-between gap-4 border-[#ded6ea] border-b p-5">
          <div>
            <p className="text-[#76678d] text-xs uppercase tracking-[0.12em]">Indexer search</p>
            <h2 className="mt-1 font-semibold text-2xl text-[#21162f]">{media.title}</h2>
            <p className="mt-1 text-[#685b78] text-sm">Compare releases from configured sources before saving.</p>
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
          <div className="text-[#76678d] text-sm">{items.length} results</div>
          <button
            type="button"
            onClick={onSearch}
            className="flex h-10 items-center gap-2 rounded-full bg-[#7c3aed] px-4 font-semibold text-sm text-white"
          >
            <Search className="size-4" />
            Search again
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

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <ReleaseRow key={item.id} item={item} />
      ))}
    </div>
  )
}

function ReleaseRow({ item }: { item: IndexerSearchItem }) {
  const uri = item.magnetUrl || item.downloadUrl

  async function handleSave() {
    if (!uri) {
      toast.error('This release does not include a usable download link.')
      return
    }

    try {
      const payload = await getZpanSaveUrl(uri)
      window.location.assign(payload.url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to open ZPan.')
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
            {item.seeders ?? 0} seeders
          </span>
        </div>
        <h3 className="line-clamp-2 font-semibold text-[#21162f] text-sm leading-5">{item.title}</h3>
        <div className="mt-2 flex flex-wrap gap-3 text-[#76678d] text-xs">
          <span>{formatBytes(item.size)}</span>
          <span>{item.publishDate ? new Date(item.publishDate).getFullYear() : 'Unknown date'}</span>
          <span>{item.infoHash ? 'Magnet ready' : 'Torrent URL'}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => void handleSave()}
        className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#7c3aed] px-4 font-semibold text-sm text-white transition hover:bg-[#6d28d9] disabled:cursor-not-allowed disabled:opacity-45"
        disabled={!uri}
      >
        Save to ZPan
        <ArrowUpRight className="size-4" />
      </button>
    </article>
  )
}
