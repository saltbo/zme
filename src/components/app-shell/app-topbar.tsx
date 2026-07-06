import type { MediaSearchItem } from '@shared/types'
import { ArrowLeft, Search } from 'lucide-react'
import type { FormEvent } from 'react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import type { TopbarBackMode, TopbarOverride } from '@/components/app-shell/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getRouteMedia, type RouteMedia } from '@/lib/routes'
import { cn } from '@/lib/utils'

interface TopbarCopy {
  title: string
  subtitle: string
  backTo?: string
  backMode?: TopbarBackMode
}

export function AppTopbar({ override }: { override: TopbarOverride | null }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const pageCopy =
    override?.pathname === location.pathname ? override : getTopbarCopy(location.pathname, location.state, t)
  const isDetailPage = Boolean(getRouteMedia(location.pathname)) || isResourceDetailPath(location.pathname)
  const showBackButton = isDetailPage || Boolean(pageCopy.backTo)
  const hideSearch = override?.pathname === location.pathname && override.hideSearch
  const [searchValue, setSearchValue] = useState('')

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = searchValue.trim()
    if (!query) return

    navigate(`${getSearchPath(location.pathname)}?q=${encodeURIComponent(query)}`)
  }

  function handleBack() {
    if (pageCopy.backMode === 'history') {
      navigate(-1)
      return
    }

    if (pageCopy.backTo) {
      navigate(pageCopy.backTo, { replace: pageCopy.backMode === 'replace' })
      return
    }

    navigate(-1)
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1680px] flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {showBackButton ? (
              <Button
                type="button"
                onClick={handleBack}
                variant="outline"
                size="icon-lg"
                className="shrink-0 rounded-full"
                aria-label="Back"
              >
                <ArrowLeft />
              </Button>
            ) : null}
            <div className="min-w-0">
              <h1 className="truncate font-semibold text-xl leading-none sm:text-2xl">{pageCopy.title}</h1>
              <p className="mt-1 truncate text-muted-foreground text-sm">{pageCopy.subtitle}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {override?.pathname === location.pathname ? override.actions : null}
            {!hideSearch ? (
              <TopbarSearchForm
                value={searchValue}
                onValueChange={setSearchValue}
                onSubmit={handleSearch}
                placeholder={t('searchPlaceholder')}
                className="hidden w-[min(36vw,420px)] md:block"
                inputClassName="h-10 rounded-full bg-background/80 pl-9 shadow-sm"
              />
            ) : null}
          </div>
        </div>
        {!hideSearch ? (
          <TopbarSearchForm
            value={searchValue}
            onValueChange={setSearchValue}
            onSubmit={handleSearch}
            placeholder={t('searchPlaceholder')}
            className="w-full min-w-0 md:hidden"
            inputClassName="h-11 rounded-full bg-background pl-9 shadow-sm"
          />
        ) : null}
      </div>
    </header>
  )
}

function TopbarSearchForm({
  className,
  inputClassName,
  onSubmit,
  onValueChange,
  placeholder,
  value,
}: {
  className: string
  inputClassName: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onValueChange: (value: string) => void
  placeholder: string
  value: string
}) {
  const inputId = useId()

  return (
    <search aria-label={placeholder} className={cn('relative block', className)}>
      <form onSubmit={onSubmit}>
        <label htmlFor={inputId} className="sr-only">
          {placeholder}
        </label>
        <Search
          aria-hidden="true"
          className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground"
        />
        <Input
          id={inputId}
          type="search"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={placeholder}
          className={inputClassName}
        />
      </form>
    </search>
  )
}

function getTopbarCopy(pathname: string, state: unknown, t: (key: string) => string): TopbarCopy {
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
  if (pathname === '/animations') {
    return {
      title: t('animations'),
      subtitle: t('animationsSubtitle'),
    }
  }
  if (pathname === '/music') {
    return {
      title: t('music'),
      subtitle: t('musicSubtitle'),
    }
  }
  if (pathname === '/books') {
    return {
      title: t('books'),
      subtitle: t('booksSubtitle'),
    }
  }
  if (pathname === '/library') {
    return {
      title: t('myLibrary'),
      subtitle: t('librarySubtitle'),
    }
  }
  if (pathname === '/downloads') {
    return {
      title: t('downloads'),
      subtitle: t('downloadsSubtitle'),
    }
  }
  if (pathname === '/settings') {
    return {
      title: t('settings'),
      subtitle: t('settingsSubtitle'),
    }
  }
  if (pathname === '/admin/users') {
    return {
      title: t('users'),
      subtitle: t('usersSubtitle'),
    }
  }
  if (pathname === '/admin/media-sources') {
    return {
      title: t('mediaSources'),
      subtitle: t('mediaSourcesSubtitle'),
    }
  }
  if (pathname === '/admin/indexers') {
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

function getSearchPath(pathname: string) {
  if (pathname.startsWith('/music')) return '/music'
  if (pathname.startsWith('/books')) return '/books'
  return '/'
}

function isResourceDetailPath(pathname: string) {
  return /^\/(?:music|books)\/[^/]+$/.test(pathname)
}

function getStateMedia(state: unknown, routeMedia: RouteMedia): MediaSearchItem | undefined {
  if (!state || typeof state !== 'object' || !('media' in state)) return undefined

  const media = (state as { media?: MediaSearchItem }).media
  if (media?.kind !== routeMedia.kind || media.id !== routeMedia.id) return undefined

  return media
}
