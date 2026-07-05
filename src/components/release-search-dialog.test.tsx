import type { ReleaseSearchMedia } from '@/components/release-search-dialog'
import { ReleaseSearchDialog } from '@/components/release-search-dialog'
import '@/i18n'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
})

function renderReleaseSearchDialog() {
  return render(
    <ReleaseSearchDialog
      media={media}
      query="Test Movie 2026"
      items={[]}
      loading={false}
      error={null}
      onClose={() => {}}
      onSearch={() => {}}
    />,
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
