import type { IndexerSearchItem } from '@shared/types'
import type { ReleaseSearchMedia } from '@/components/release-search-dialog'
import { ReleaseSearchDialog, ReleaseSearchSurface } from '@/components/release-search-dialog'
import '@/i18n'
import { render, screen } from '@testing-library/react'
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
  items: IndexerSearchItem[]
  loading: boolean
  progress: ReleaseSearchProgress | null
}) {
  return render(renderReleaseSearchSurfaceElement({ items, loading, progress }))
}

function renderReleaseSearchSurfaceElement({
  items,
  loading,
  progress,
}: {
  items: IndexerSearchItem[]
  loading: boolean
  progress: ReleaseSearchProgress | null
}) {
  return (
    <ReleaseSearchSurface
      media={media}
      query="Kind of Blue Miles Davis 1959 Vinyl"
      items={items}
      loading={loading}
      error={null}
      progress={progress}
      onSearch={() => {}}
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
  phase: 'primary',
  steps: [
    {
      id: 'primary-0-kind-of-blue',
      query: 'Kind of Blue Miles Davis',
      phase: 'primary',
      status: 'completed',
      resultCount: 1,
    },
    {
      id: 'primary-1-kind-of-blue-vinyl',
      query: 'Kind of Blue Vinyl',
      phase: 'primary',
      status: 'running',
      resultCount: null,
    },
    {
      id: 'primary-2-kind-of-blue-flac',
      query: 'Kind of Blue FLAC',
      phase: 'primary',
      status: 'pending',
      resultCount: null,
    },
  ],
}
