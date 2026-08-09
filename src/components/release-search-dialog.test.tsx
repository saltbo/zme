import type { ReleaseCandidateFull } from '@shared/types'
import type { ReleaseSearchMedia } from '@/components/release-search-dialog'
import { ReleaseSearchDialog, ReleaseSearchSurface } from '@/components/release-search-dialog'
import '@/i18n'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReleaseSearchProgress } from '@/lib/release-search'

vi.mock('@/hooks/use-downloader-queries', () => ({
  useDownloaders: () => ({ data: [], error: null, isLoading: false }),
}))

describe('ReleaseSearchDialog scroll lock', () => {
  afterEach(() => {
    document.body.removeAttribute('style')
    vi.restoreAllMocks()
  })

  it('locks and restores body scroll for the mobile release sheet', () => {
    mockDesktopMedia(false)
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(0)
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(240)
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})

    const { unmount } = renderReleaseSearchDialog()

    expect(document.body.style.position).toBe('fixed')
    expect(document.body.style.top).toBe('-240px')

    unmount()

    expect(document.body.style.position).toBe('')
    expect(document.body.style.top).toBe('')
    expect(scrollTo).toHaveBeenLastCalledWith(0, 240)
  })

  it('keeps desktop release dialog behavior outside the mobile body lock', () => {
    mockDesktopMedia(true)

    renderReleaseSearchDialog()

    expect(document.body.style.position).toBe('')
    expect(document.body.style.top).toBe('')
  })

  it('hides the mobile filter trigger while a dialog search is loading', () => {
    mockDesktopMedia(false)

    renderReleaseSearchDialog({ loading: true, progress: releaseSearchProgress })

    expect(screen.queryByRole('button', { name: 'Filters' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Searching indexers' })).toBeInTheDocument()
  })
})

describe('ReleaseSearchSurface standalone page', () => {
  it('shows progress instead of filter controls while loading, then shows filters and summary', () => {
    const { rerender } = renderReleaseSearchSurface({
      items: [],
      loading: true,
      progress: releaseSearchProgress,
    })

    expect(screen.getAllByText('1 / 3 complete, 2 requests running').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Searching indexers' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Filter titles or indexers')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Search again' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Showing \d+ \/ \d+ results/)).not.toBeInTheDocument()

    rerender(renderReleaseSearchSurfaceElement({ items: [], loading: false, progress: null }))

    expect(screen.getByPlaceholderText('Filter titles or indexers')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search again' })).toBeInTheDocument()
    expect(screen.getAllByText('Showing 0 / 0 results').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Search query/i)).not.toBeInTheDocument()
  })

  it('shows accepted releases immediately while supplemental searches continue', () => {
    renderReleaseSearchSurface({
      items: [release],
      loading: true,
      progress: releaseSearchProgress,
    })

    expect(screen.getByText(release.title)).toBeInTheDocument()
    expect(screen.getByText(release.indexer)).toBeInTheDocument()
    expect(screen.getByText('10 seeders')).toBeInTheDocument()
    expect(screen.getByText('0 leechers')).toBeInTheDocument()
    expect(screen.getByText('1 files')).toBeInTheDocument()
    expect(screen.getByText('Torrent URL')).toBeInTheDocument()
    expect(screen.getAllByText('1 results available to browse now').length).toBeGreaterThan(0)
    expect(screen.queryByRole('heading', { name: 'Searching indexers' })).not.toBeInTheDocument()
  })

  it('offers exhaustive alias search after automatic early stopping', () => {
    const onSearchMore = vi.fn()
    render(
      renderReleaseSearchSurfaceElement({
        items: [release],
        loading: false,
        progress: null,
        canSearchMore: true,
        onSearchMore,
      }),
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Search other titles' })[0])

    expect(onSearchMore).toHaveBeenCalledOnce()
  })
})

function renderReleaseSearchDialog({
  loading = false,
  progress = null,
}: {
  loading?: boolean
  progress?: ReleaseSearchProgress | null
} = {}) {
  return render(
    <ReleaseSearchDialog
      media={media}
      query="Test Movie 2026"
      items={[]}
      loading={loading}
      error={null}
      progress={progress}
      onClose={() => {}}
      onSearch={() => {}}
    />,
  )
}

function renderReleaseSearchSurface({
  items,
  loading,
  progress,
}: {
  items: ReleaseCandidateFull[]
  loading: boolean
  progress: ReleaseSearchProgress | null
}) {
  return render(renderReleaseSearchSurfaceElement({ items, loading, progress }))
}

function renderReleaseSearchSurfaceElement({
  items,
  loading,
  progress,
  canSearchMore = false,
  onSearchMore = () => {},
}: {
  items: ReleaseCandidateFull[]
  loading: boolean
  progress: ReleaseSearchProgress | null
  canSearchMore?: boolean
  onSearchMore?: () => void
}) {
  return (
    <ReleaseSearchSurface
      media={media}
      query="Kind of Blue Miles Davis 1959 Vinyl"
      items={items}
      loading={loading}
      error={null}
      progress={progress}
      canSearchMore={canSearchMore}
      onSearch={() => {}}
      onSearchMore={onSearchMore}
    />
  )
}

function mockDesktopMedia(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  )
}

const media: ReleaseSearchMedia = {
  id: 1,
  kind: 'movie',
  title: 'Test Movie',
  originalTitle: 'Test Movie',
  overview: '',
  posterUrl: null,
  backdropUrl: null,
  releaseYear: '2026',
  rating: null,
  genres: [],
}

const releaseSearchProgress: ReleaseSearchProgress = {
  completed: 1,
  total: 3,
  active: 2,
  phase: 'automatic',
  steps: [
    {
      id: 'primary-0-kind-of-blue',
      query: 'Kind of Blue Miles Davis',
      kind: 'original',
      status: 'completed',
      resultCount: 1,
    },
    {
      id: 'primary-1-kind-of-blue-vinyl',
      query: 'Kind of Blue Vinyl',
      kind: 'localized',
      status: 'running',
      resultCount: null,
    },
    {
      id: 'primary-2-kind-of-blue-flac',
      query: 'Kind of Blue FLAC',
      kind: 'english',
      status: 'pending',
      resultCount: null,
    },
  ],
}

const release: ReleaseCandidateFull = {
  id: 'release-1',
  downloadTarget: null,
  title: 'Test Movie 2026 1080p WEB-DL',
  fileName: null,
  indexer: 'Test Indexer',
  size: 1_000,
  quality: {
    resolution: '1080p',
    source: 'webdl',
    codec: null,
    hdr: null,
    audio: null,
    tier: 'good',
    warnings: [],
  },
  availability: { tier: 'medium' },
  seeders: 10,
  leechers: 0,
  files: 1,
  publishDate: null,
  resourceRef: 'release-ref:v1:test',
  resourceRefExpiresAt: '2026-08-08T00:00:00.000Z',
  sourceType: 'torrent_url',
  infoUrl: null,
  categories: [],
  categoryIds: [],
  indexerFlags: [],
  imdbId: null,
  tmdbId: null,
  tvdbId: null,
}
