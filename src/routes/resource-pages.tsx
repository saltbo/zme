import type {
  BookDetails,
  BookSearchItem,
  DownloadSearchTarget,
  IndexerSearchItem,
  LibraryKind,
  LibraryResourceInput,
  MusicAlbumDetails,
  MusicAlbumSearchItem,
} from '@shared/types'
import { useMutation } from '@tanstack/react-query'
import { BookOpen, CalendarDays, Disc3, Heart, Languages, ListMusic, RotateCcw, Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useOutletContext, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import type { AppOutletContext } from '@/components/app-shell/types'
import {
  ReleaseSearchDialog,
  type ReleaseSearchError,
  type ReleaseSearchMedia,
} from '@/components/release-search-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { type MediaStatus, useLibrary } from '@/contexts/library'
import { useBookDetails, useBookSearch, useMusicAlbumDetails, useMusicSearch } from '@/hooks/use-resource-queries'
import { ApiError, searchIndexers } from '@/lib/api'
import { cn } from '@/lib/utils'

type ResourceKind = Extract<LibraryKind, 'music' | 'book'>

const resourceSkeletonKeys = [
  'resource-skeleton-1',
  'resource-skeleton-2',
  'resource-skeleton-3',
  'resource-skeleton-4',
  'resource-skeleton-5',
  'resource-skeleton-6',
]

export function MusicPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const query = searchParams.get('q')?.trim() ?? ''
  const search = useMusicSearch(query)

  useEffect(() => {
    if (search.error) toast.error(search.error instanceof Error ? search.error.message : t('searchFailed'))
  }, [search.error, t])

  return (
    <ResourceSearchPage
      title={t('music')}
      emptyTitle={t('searchMusic')}
      emptyDescription={t('searchMusicDescription')}
      query={query}
      loading={search.isLoading}
      items={(search.data ?? []).map((item) => ({ key: item.mediaKey, node: <MusicAlbumCard item={item} /> }))}
    />
  )
}

export function BooksPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const query = searchParams.get('q')?.trim() ?? ''
  const search = useBookSearch(query)

  useEffect(() => {
    if (search.error) toast.error(search.error instanceof Error ? search.error.message : t('searchFailed'))
  }, [search.error, t])

  return (
    <ResourceSearchPage
      title={t('books')}
      emptyTitle={t('searchBooks')}
      emptyDescription={t('searchBooksDescription')}
      query={query}
      loading={search.isLoading}
      items={(search.data ?? []).map((item) => ({ key: item.mediaKey, node: <BookCard item={item} /> }))}
    />
  )
}

function ResourceSearchPage({
  title,
  emptyTitle,
  emptyDescription,
  query,
  loading,
  items,
}: {
  title: string
  emptyTitle: string
  emptyDescription: string
  query: string
  loading: boolean
  items: { key: string; node: ReactNode }[]
}) {
  const { t } = useTranslation()

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1680px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <div className="mb-5 flex items-center justify-between gap-3 border-b pb-4">
        <div className="min-w-0">
          <div className="font-semibold text-sm text-muted-foreground">{title}</div>
          <div className="mt-1 truncate text-muted-foreground text-sm">
            {query ? t('resourceSearchResultCount', { count: items.length, query }) : emptyDescription}
          </div>
        </div>
      </div>

      {!query ? (
        <Card className="flex min-h-80 items-center justify-center p-8 text-center">
          <CardContent className="max-w-md px-0">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Search className="size-5" />
            </div>
            <h2 className="mt-4 font-semibold">{emptyTitle}</h2>
            <p className="mt-2 text-muted-foreground text-sm">{emptyDescription}</p>
          </CardContent>
        </Card>
      ) : null}

      {loading ? <ResourceGridSkeleton /> : null}
      {query && !loading && items.length === 0 ? (
        <Card className="flex min-h-80 items-center justify-center p-8 text-muted-foreground">
          {t('noMatchedMedia')}
        </Card>
      ) : null}
      {!loading && items.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-4 sm:gap-y-7 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
          {items.map((item) => (
            <div key={item.key}>{item.node}</div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function MusicDetailPage() {
  const location = useLocation()
  const { key } = useParams()
  const { setTopbarOverride } = useOutletContext<AppOutletContext>()
  const { t } = useTranslation()
  const mediaKey = key ?? ''
  const details = useMusicAlbumDetails(mediaKey)
  const album = details.data ?? null
  const [releaseDialog, setReleaseDialog] = useState<ReleaseDialogState | null>(null)
  const releaseSearch = useResourceReleaseSearch(setReleaseDialog)

  useEffect(() => {
    if (!album) return
    setTopbarOverride({
      pathname: location.pathname,
      title: album.title,
      subtitle: `${t('music')} / ${album.artist ?? album.releaseYear ?? t('unknown')}`,
    })
    return () => setTopbarOverride(null)
  }, [album, location.pathname, setTopbarOverride, t])

  function openReleaseSearch() {
    if (!album) return
    openResourceReleaseSearch({
      input: getMusicReleaseSearchInput(album),
      label: t('musicDownload'),
      releaseSearch,
      setReleaseDialog,
    })
  }

  if (details.isLoading) return <ResourceDetailSkeleton />
  if (!album)
    return <ResourceDetailError message={details.error instanceof Error ? details.error.message : t('mediaNotFound')} />

  const statusInput = { kind: 'music' as const, mediaKey: album.mediaKey }
  return (
    <ResourceDetailLayout
      kind="music"
      imageUrl={album.coverArt.frontUrl ?? album.coverArt.frontThumbnailUrl}
      title={album.title}
      subtitle={album.artist ?? t('unknown')}
      description={album.disambiguation}
      badges={[album.releaseYear, album.primaryType, album.country, ...album.secondaryTypes].filter(isString)}
      statusInput={statusInput}
      actions={
        <Button type="button" onClick={openReleaseSearch} size="lg">
          <Search data-icon="inline-start" />
          {t('musicDownload')}
        </Button>
      }
      meta={
        <>
          <ResourceFact
            icon={<CalendarDays />}
            label={t('releaseDate')}
            value={album.releaseDate ?? t('unknownDate')}
          />
          <ResourceFact icon={<Disc3 />} label={t('formats')} value={album.formats.join(', ') || t('unknown')} />
          <ResourceFact icon={<ListMusic />} label={t('tracks')} value={String(getTrackCount(album))} />
        </>
      }
      sections={
        <>
          <ResourceSection title={t('trackList')}>
            {album.media.length > 0 ? (
              <div className="space-y-4">
                {album.media.map((medium) => (
                  <div key={medium.position} className="rounded-xl border p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h3 className="font-semibold text-sm">
                        {medium.title ?? medium.format ?? `${t('disc')} ${medium.position}`}
                      </h3>
                      <Badge variant="secondary">{medium.trackCount}</Badge>
                    </div>
                    <div className="space-y-2">
                      {medium.tracks.map((track) => (
                        <div
                          key={`${medium.position}-${track.position}`}
                          className="grid grid-cols-[3rem_minmax(0,1fr)_4rem] gap-3 text-sm"
                        >
                          <span className="text-muted-foreground">{track.number ?? track.position}</span>
                          <span className="truncate">{track.title}</span>
                          <span className="text-right text-muted-foreground">{formatTrackLength(track.lengthMs)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyResourceSection />
            )}
          </ResourceSection>
          <ResourceReleaseDialog
            state={releaseDialog}
            loading={releaseSearch.isPending}
            onClose={() => setReleaseDialog(null)}
            onSearch={() => releaseSearch.mutate(releaseDialog?.input)}
          />
        </>
      }
    />
  )
}

export function BookDetailPage() {
  const location = useLocation()
  const { key } = useParams()
  const { setTopbarOverride } = useOutletContext<AppOutletContext>()
  const { t } = useTranslation()
  const mediaKey = key ?? ''
  const details = useBookDetails(mediaKey)
  const book = details.data ?? null
  const [releaseDialog, setReleaseDialog] = useState<ReleaseDialogState | null>(null)
  const releaseSearch = useResourceReleaseSearch(setReleaseDialog)

  useEffect(() => {
    if (!book) return
    setTopbarOverride({
      pathname: location.pathname,
      title: book.title,
      subtitle: `${t('book')} / ${book.authors.join(', ') || t('unknown')}`,
    })
    return () => setTopbarOverride(null)
  }, [book, location.pathname, setTopbarOverride, t])

  function openBookReleaseSearch(target: 'ebook' | 'audiobook') {
    if (!book) return
    const targetLabel = target === 'ebook' ? t('ebook') : t('audiobook')
    openResourceReleaseSearch({
      input: getBookReleaseSearchInput(book, target),
      label: targetLabel,
      releaseSearch,
      setReleaseDialog,
    })
  }

  if (details.isLoading) return <ResourceDetailSkeleton />
  if (!book)
    return <ResourceDetailError message={details.error instanceof Error ? details.error.message : t('mediaNotFound')} />

  const statusInput = { kind: 'book' as const, mediaKey: book.mediaKey }
  return (
    <ResourceDetailLayout
      kind="book"
      imageUrl={book.coverUrl}
      title={book.title}
      subtitle={book.authors.join(', ') || t('unknown')}
      description={book.description}
      badges={[book.firstPublishYear ? String(book.firstPublishYear) : null, ...book.languages].filter(isString)}
      statusInput={statusInput}
      actions={
        <div className="grid gap-2 sm:grid-cols-2">
          <Button type="button" onClick={() => openBookReleaseSearch('ebook')} size="lg">
            <Search data-icon="inline-start" />
            {t('ebook')}
          </Button>
          <Button type="button" onClick={() => openBookReleaseSearch('audiobook')} size="lg" variant="secondary">
            <Search data-icon="inline-start" />
            {t('audiobook')}
          </Button>
        </div>
      }
      meta={
        <>
          <ResourceFact
            icon={<CalendarDays />}
            label={t('firstPublished')}
            value={book.firstPublishYear ? String(book.firstPublishYear) : t('unknownYear')}
          />
          <ResourceFact icon={<Languages />} label={t('language')} value={book.languages.join(', ') || t('unknown')} />
          <ResourceFact
            icon={<BookOpen />}
            label="ISBN"
            value={book.isbnCandidates.slice(0, 3).join(', ') || t('unknown')}
          />
        </>
      }
      sections={
        <>
          <ResourceSection title={t('editions')}>
            {book.editionCandidates.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {book.editionCandidates.slice(0, 12).map((edition) => (
                  <Card key={edition.mediaKey} className="p-4">
                    <CardContent className="px-0">
                      <h3 className="line-clamp-2 font-semibold text-sm">{edition.title ?? book.title}</h3>
                      <div className="mt-2 text-muted-foreground text-xs">
                        {[edition.publishYear, edition.languages.join(', '), edition.openLibraryId]
                          .filter(Boolean)
                          .join(' / ')}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyResourceSection />
            )}
          </ResourceSection>
          <ResourceReleaseDialog
            state={releaseDialog}
            loading={releaseSearch.isPending}
            onClose={() => setReleaseDialog(null)}
            onSearch={() => releaseSearch.mutate(releaseDialog?.input)}
          />
        </>
      }
    />
  )
}

function ResourceDetailLayout({
  kind,
  imageUrl,
  title,
  subtitle,
  description,
  badges,
  statusInput,
  actions,
  meta,
  sections,
}: {
  kind: ResourceKind
  imageUrl: string | null | undefined
  title: string
  subtitle: string
  description: string | null
  badges: string[]
  statusInput: LibraryResourceInput
  actions: ReactNode
  meta: ReactNode
  sections: ReactNode
}) {
  const { t } = useTranslation()
  const { getResourceStatus, setResourceStatus } = useLibrary()
  const status = getResourceStatus(statusInput)

  async function updateStatus(nextStatus: Extract<MediaStatus, 'none' | 'saved'>) {
    try {
      await setResourceStatus(statusInput, nextStatus)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('mediaStatusToggleFailed'))
    }
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1520px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <section className="grid gap-5 rounded-2xl border bg-card p-4 sm:p-5 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-7 lg:p-6">
        <div className="overflow-hidden rounded-xl bg-muted">
          {imageUrl ? (
            <img src={imageUrl} alt={`${title} cover`} className="aspect-[2/3] w-full object-cover" />
          ) : (
            <div className="flex aspect-[2/3] items-center justify-center text-muted-foreground">
              {kind === 'book' ? <BookOpen className="size-10" /> : <Disc3 className="size-10" />}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <Badge variant="secondary" className="mb-3">
                {kind === 'book' ? t('book') : t('music')}
              </Badge>
              <h1 className="text-balance font-semibold text-3xl leading-tight sm:text-5xl">{title}</h1>
              <p className="mt-3 text-muted-foreground">{subtitle}</p>
            </div>
            <Button
              type="button"
              variant={status === 'saved' ? 'secondary' : 'outline'}
              size="icon-lg"
              className="shrink-0 rounded-full"
              onClick={() => void updateStatus(status === 'saved' ? 'none' : 'saved')}
              aria-label={status === 'saved' ? t('removeFromLibrary') : t('saveToLibrary')}
              title={status === 'saved' ? t('removeFromLibrary') : t('saveToLibrary')}
            >
              {status === 'saved' ? <RotateCcw /> : <Heart />}
            </Button>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {badges.map((badge) => (
              <Badge key={badge} variant="outline">
                {badge}
              </Badge>
            ))}
          </div>
          {description ? (
            <p className="mt-5 line-clamp-6 max-w-4xl text-muted-foreground leading-7">{description}</p>
          ) : null}
          <div className="mt-6 grid gap-3 md:grid-cols-3">{meta}</div>
          <div className="mt-6">{actions}</div>
        </div>
      </section>
      <div className="mt-7">{sections}</div>
    </div>
  )
}

function MusicAlbumCard({ item }: { item: MusicAlbumSearchItem }) {
  return (
    <ResourceCard
      kind="music"
      mediaKey={item.mediaKey}
      to={`/music/${encodeURIComponent(item.mediaKey)}`}
      imageUrl={item.coverArt.frontThumbnailUrl ?? item.coverArt.frontUrl}
      title={item.title}
      subtitle={item.artist ?? ''}
      meta={[item.releaseYear, item.primaryType].filter(isString).join(' / ')}
    />
  )
}

function BookCard({ item }: { item: BookSearchItem }) {
  return (
    <ResourceCard
      kind="book"
      mediaKey={item.mediaKey}
      to={`/books/${encodeURIComponent(item.mediaKey)}`}
      imageUrl={item.coverUrl}
      title={item.title}
      subtitle={item.authors.join(', ')}
      meta={[item.firstPublishYear ? String(item.firstPublishYear) : null, item.languages.slice(0, 2).join(', ')]
        .filter(isString)
        .join(' / ')}
    />
  )
}

export function LibraryResourceCard({ kind, mediaKey }: { kind: ResourceKind; mediaKey: string }) {
  const music = useMusicAlbumDetails(mediaKey, { enabled: kind === 'music' })
  const book = useBookDetails(mediaKey, { enabled: kind === 'book' })
  const loading = kind === 'music' ? music.isLoading : book.isLoading

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="aspect-[2/3] rounded-xl" />
        <Skeleton className="mx-1 h-4 w-2/3" />
        <Skeleton className="mx-1 h-3 w-1/2" />
      </div>
    )
  }

  if (kind === 'music' && music.data) return <MusicAlbumCard item={music.data} />
  if (kind === 'book' && book.data) return <BookCard item={book.data} />

  return (
    <Card className="flex aspect-[2/3] items-center justify-center break-all p-4 text-center text-muted-foreground text-sm">
      {mediaKey}
    </Card>
  )
}

function ResourceCard({
  kind,
  mediaKey,
  to,
  imageUrl,
  title,
  subtitle,
  meta,
}: {
  kind: ResourceKind
  mediaKey: string
  to: string
  imageUrl: string | null | undefined
  title: string
  subtitle: string
  meta: string
}) {
  const { t } = useTranslation()
  const { getResourceStatus, setResourceStatus } = useLibrary()
  const status = getResourceStatus({ kind, mediaKey })

  async function toggleSaved() {
    try {
      await setResourceStatus({ kind, mediaKey }, status === 'saved' ? 'none' : 'saved')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('mediaStatusToggleFailed'))
    }
  }

  return (
    <Card className="group gap-0 overflow-visible bg-transparent p-0 ring-0">
      <CardContent className="relative aspect-[2/3] overflow-hidden rounded-xl bg-card p-0 shadow-[0_18px_38px_rgba(33,22,47,0.18)] ring-1 ring-foreground/10 transition duration-300 group-hover:-translate-y-1">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`${title} cover`}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            {kind === 'book' ? <BookOpen className="size-8" /> : <Disc3 className="size-8" />}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#120c1d] via-[#120c1d]/18 to-transparent opacity-92" />
        <Link to={to} aria-label={title} className="absolute inset-0 z-10" />
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void toggleSaved()
          }}
          aria-label={status === 'saved' ? t('removeFromLibrary') : t('saveToLibrary')}
          title={status === 'saved' ? t('removeFromLibrary') : t('saveToLibrary')}
          className={cn(
            'absolute top-2 right-2 z-30 flex size-10 items-center justify-center text-white/88 drop-shadow-[0_2px_6px_rgba(0,0,0,0.55)] transition hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white md:group-hover:opacity-100',
            status === 'none' && 'opacity-100 hover:text-[#f06595] md:opacity-0',
            status === 'saved' && 'text-[#f06595] opacity-100',
          )}
        >
          <Heart className={cn('size-6', status === 'saved' && 'fill-[#f06595] text-[#f06595]')} />
        </button>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-4 text-white">
          <Badge variant="secondary" className="mb-2 bg-white/14 text-white backdrop-blur">
            {kind === 'book' ? t('book') : t('music')}
          </Badge>
          <h2 className="line-clamp-2 text-balance font-semibold text-base leading-tight drop-shadow sm:text-xl">
            {title}
          </h2>
        </div>
      </CardContent>
      <CardContent className="px-1 pt-3">
        <div className="min-w-0 text-muted-foreground text-sm">
          <Tooltip>
            <TooltipTrigger className="min-w-0">
              <span className="block truncate text-left">{subtitle || t('unknown')}</span>
            </TooltipTrigger>
            <TooltipContent>{subtitle || t('unknown')}</TooltipContent>
          </Tooltip>
          {meta ? <div className="mt-1 truncate text-xs">{meta}</div> : null}
        </div>
      </CardContent>
    </Card>
  )
}

interface ReleaseDialogState {
  item: ReleaseSearchMedia
  label: string
  query: string
  releases: IndexerSearchItem[]
  error: ReleaseSearchError | null
  input: ResourceReleaseSearchInput
}

interface ResourceReleaseSearchInput {
  target: DownloadSearchTarget
  query: string
  item: ReleaseSearchMedia
  title: string
  aliases: string[]
  creators: string[]
  year: string | null
  formats: string[]
  narrator: string | null
}

function useResourceReleaseSearch(setReleaseDialog: (state: ReleaseDialogState | null) => void) {
  const { t } = useTranslation()

  return useMutation({
    mutationFn: async (input: ResourceReleaseSearchInput | undefined) => {
      if (!input) throw new Error('Release search input is missing.')
      const payload = await searchIndexers({
        query: input.query,
        target: input.target,
        title: input.title,
        aliases: input.aliases,
        creators: input.creators,
        year: input.year,
        formats: input.formats,
        narrator: input.narrator,
      })
      return { input, results: payload.results }
    },
    onSuccess: ({ input, results }) => {
      setReleaseDialog({
        item: input.item,
        label: input.target,
        query: input.query,
        releases: results,
        error: null,
        input,
      })
    },
    onError: (error, input) => {
      if (!input) return
      setReleaseDialog({
        item: input.item,
        label: input.target,
        query: input.query,
        releases: [],
        error: getReleaseSearchError(error, t),
        input,
      })
    },
  })
}

function openResourceReleaseSearch({
  input,
  label,
  releaseSearch,
  setReleaseDialog,
}: {
  input: ResourceReleaseSearchInput
  label: string
  releaseSearch: ReturnType<typeof useResourceReleaseSearch>
  setReleaseDialog: (state: ReleaseDialogState | null) => void
}) {
  setReleaseDialog({ item: input.item, label, query: input.query, releases: [], error: null, input })
  releaseSearch.mutate(input)
}

function ResourceReleaseDialog({
  state,
  loading,
  onClose,
  onSearch,
}: {
  state: ReleaseDialogState | null
  loading: boolean
  onClose: () => void
  onSearch: () => void
}) {
  if (!state) return null

  return (
    <ReleaseSearchDialog
      media={state.item}
      query={state.query}
      items={state.releases}
      loading={loading}
      error={state.error}
      onClose={onClose}
      onSearch={onSearch}
    />
  )
}

export function getMusicReleaseSearchInput(album: MusicAlbumDetails): ResourceReleaseSearchInput {
  const creators = getMusicCreators(album)
  const formats = uniqueStrings([...album.formats, album.primaryType, ...album.secondaryTypes, 'flac', 'mp3'])
  const aliases = uniqueStrings([
    ...album.aliases.map((alias) => alias.name),
    ...album.releases.map((release) => release.title),
  ])
  const query = [album.title, creators[0], album.releaseYear, formats[0]].filter(Boolean).join(' ')

  return {
    target: 'music',
    query,
    item: toMusicReleaseMedia(album),
    title: album.title,
    aliases,
    creators,
    year: album.releaseYear,
    formats,
    narrator: null,
  }
}

export function getBookReleaseSearchInput(
  book: BookDetails,
  target: Extract<DownloadSearchTarget, 'ebook' | 'audiobook'>,
): ResourceReleaseSearchInput {
  const targetFormat = target === 'ebook' ? 'ebook' : 'audiobook'
  const formats = target === 'ebook' ? ['ebook', 'epub', 'mobi', 'azw3', 'pdf'] : ['audiobook', 'm4b', 'm4a', 'mp3']
  const year = book.firstPublishYear ? String(book.firstPublishYear) : null
  const query = [book.title, book.authors[0], year, targetFormat].filter(Boolean).join(' ')

  return {
    target,
    query,
    item: toBookReleaseMedia(book, target),
    title: book.title,
    aliases: uniqueStrings(book.aliases),
    creators: uniqueStrings(book.authors),
    year,
    formats,
    narrator: null,
  }
}

function toMusicReleaseMedia(album: MusicAlbumDetails): ReleaseSearchMedia {
  return {
    id: 0,
    kind: 'movie',
    title: album.title,
    originalTitle: album.title,
    overview: album.disambiguation ?? '',
    posterUrl: album.coverArt.frontUrl,
    backdropUrl: null,
    releaseYear: album.releaseYear,
    rating: null,
    genres: album.secondaryTypes,
    downloadCategory: 'zme:music',
    downloadTags: [`mediaKey=${album.mediaKey}`, 'kind=music'],
  }
}

function toBookReleaseMedia(book: BookDetails, target: 'ebook' | 'audiobook'): ReleaseSearchMedia {
  return {
    id: 0,
    kind: 'movie',
    title: book.title,
    originalTitle: book.title,
    overview: book.description ?? '',
    posterUrl: book.coverUrl,
    backdropUrl: null,
    releaseYear: book.firstPublishYear ? String(book.firstPublishYear) : null,
    rating: null,
    genres: book.languages,
    downloadCategory: `zme:book:${target}`,
    downloadTags: [`mediaKey=${book.mediaKey}`, 'kind=book', `target=${target}`],
  }
}

function getMusicCreators(album: MusicAlbumDetails) {
  return uniqueStrings([...album.artists.map((artist) => artist.name), album.artist])
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))))
}

function ResourceFact({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border bg-background p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 truncate font-medium text-sm">{value}</div>
    </div>
  )
}

function ResourceSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 font-semibold text-xl">{title}</h2>
      {children}
    </section>
  )
}

function EmptyResourceSection() {
  const { t } = useTranslation()
  return (
    <Card className="flex min-h-40 items-center justify-center p-6 text-muted-foreground">
      {t('noResourceDetails')}
    </Card>
  )
}

function ResourceGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-4 sm:gap-y-7 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
      {resourceSkeletonKeys.map((key) => (
        <div key={key} className="flex flex-col gap-3">
          <Skeleton className="aspect-[2/3] rounded-xl" />
          <Skeleton className="mx-1 h-4 w-2/3" />
          <Skeleton className="mx-1 h-3 w-1/2" />
        </div>
      ))}
    </div>
  )
}

function ResourceDetailSkeleton() {
  return (
    <div className="mx-auto w-full min-w-0 max-w-[1520px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <div className="grid gap-5 rounded-2xl border bg-card p-4 sm:p-5 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-7 lg:p-6">
        <Skeleton className="aspect-[2/3] rounded-xl" />
        <div className="space-y-4">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  )
}

function ResourceDetailError({ message }: { message: string }) {
  return (
    <div className="mx-auto w-full min-w-0 max-w-[1520px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <Card className="flex min-h-80 items-center justify-center p-8 text-muted-foreground">{message}</Card>
    </div>
  )
}

function getReleaseSearchError(error: unknown, t: (key: string) => string): ReleaseSearchError {
  if (error instanceof ApiError && error.status === 404) {
    return {
      title: t('indexerNotConfiguredTitle'),
      description: t('indexerNotConfiguredDescription'),
      action: t('retrySearch'),
      tone: 'configuration',
    }
  }

  return {
    title: t('indexerSearchFailedTitle'),
    description: error instanceof Error ? error.message : t('indexerSearchFailedDescription'),
    action: t('retrySearch'),
    tone: 'generic',
  }
}

function getTrackCount(album: MusicAlbumDetails) {
  return album.media.reduce((total, medium) => total + medium.trackCount, 0)
}

function formatTrackLength(lengthMs: number | null) {
  if (!lengthMs) return ''
  const totalSeconds = Math.round(lengthMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

function isString(value: string | null | undefined): value is string {
  return Boolean(value)
}
