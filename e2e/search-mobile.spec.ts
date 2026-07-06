import { expect, type Locator, type Page, test } from '@playwright/test'

const BASE_URL = 'http://localhost:7171'
const ADMIN = {
  name: process.env.LOCAL_TEST_NAME ?? 'E2E Admin',
  email: process.env.LOCAL_TEST_EMAIL ?? 'e2e-admin@zme.test',
  password: process.env.LOCAL_TEST_PASSWORD ?? 'e2e-password-123',
}

const DESKTOP_VIEWPORT = { width: 1280, height: 900 }
const MOBILE_VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]
const SEARCH_PLACEHOLDER = 'Search resources'

test.describe('mobile search regressions', () => {
  test('mobile global search is reachable at 390px and 430px and matches desktop routing', async ({ page }) => {
    await signIn(page)
    await stubResourceSearchApis(page)

    const desktopTarget = await submitSearchFromMusic(page, DESKTOP_VIEWPORT, 'Kind of Blue')
    expect(desktopTarget.pathname).toBe('/music')
    expect(desktopTarget.searchParams.get('q')).toBe('Kind of Blue')

    for (const viewport of MOBILE_VIEWPORTS) {
      await test.step(`submits from ${viewport.width}px`, async () => {
        const mobileTarget = await submitSearchFromMusic(page, viewport, 'Kind of Blue')
        expect(mobileTarget.pathname).toBe(desktopTarget.pathname)
        expect(mobileTarget.searchParams.get('q')).toBe(desktopTarget.searchParams.get('q'))
      })
    }
  })

  test('mobile release search route opens filters from the top-right bottom sheet', async ({ page }) => {
    await signIn(page)
    await stubReleaseSearchApis(page)

    for (const viewport of MOBILE_VIEWPORTS) {
      await test.step(`release filters at ${viewport.width}px`, async () => {
        await page.setViewportSize(viewport)
        await page.goto(`/music/${encodeURIComponent(MUSIC_RELEASE_KEY)}/releases`)

        await expect(page.getByRole('heading', { name: 'Kind of Blue', exact: true })).toBeVisible()
        await expect(page.getByText(RELEASE_SEARCH_CONTEXT)).toBeVisible()
        expect(await visibleLocator(page.getByPlaceholder('Filter titles or indexers'))).toBeNull()
        await expect(page.getByText('Miles Davis Kind of Blue 1959 FLAC')).toBeVisible()
        await expect(page.getByRole('button', { name: 'No downloaders' })).toBeVisible()
        await expectNoHorizontalOverflow(page)

        const filtersButton = page.getByRole('button', { name: 'Filters' })
        await expect(filtersButton).toBeVisible()
        await filtersButton.click()

        await expect(page.getByRole('dialog')).toBeVisible()
        await expect(page.getByRole('heading', { name: 'Filters' })).toBeVisible()
        const mobileFilterInput = await visibleLocator(page.getByPlaceholder('Filter titles or indexers'))
        if (!mobileFilterInput) throw new Error('Expected a visible release filter input in the bottom sheet.')
        await expect(mobileFilterInput).toBeVisible()
        await expectNoHorizontalOverflow(page)
      })
    }
  })

  test('desktop release search route uses a page toolbar and result list', async ({ page }) => {
    await signIn(page)
    await stubReleaseSearchApis(page)
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await page.goto(`/music/${encodeURIComponent(MUSIC_RELEASE_KEY)}/releases`)

    await expect(page.getByRole('heading', { name: 'Kind of Blue', exact: true })).toBeVisible()
    await expect(page.getByText(RELEASE_SEARCH_CONTEXT)).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByPlaceholder('Filter titles or indexers')).toBeVisible()
    const resultSummary = await visibleLocator(page.getByText('Showing 1 / 1 results'))
    if (!resultSummary) throw new Error('Expected a visible result summary in the page toolbar.')
    await expect(resultSummary).toBeVisible()
    await expect(page.getByText('Miles Davis Kind of Blue 1959 FLAC')).toBeVisible()
    await expect(page.getByRole('button', { name: 'No downloaders' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})

async function signIn(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('zme.language', 'en-US'))

  const setup = await page.request.post('/api/setup/admin', { data: ADMIN })
  expect([201, 409]).toContain(setup.status())

  const signInResponse = await page.request.post('/api/auth/sign-in/email', {
    data: { email: ADMIN.email, password: ADMIN.password },
    headers: { Origin: BASE_URL },
  })
  await expect(signInResponse).toBeOK()
}

async function stubResourceSearchApis(page: Page) {
  await page.route(/\/api\/library\/states(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: { items: [] } })
  })
  await page.route(/\/api\/music\/(?:discover|search)(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: emptyResourcePage() })
  })
}

async function stubReleaseSearchApis(page: Page) {
  await page.route(/\/api\/library\/states(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: { items: [] } })
  })
  await page.route(/\/api\/downloaders(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: { items: [] } })
  })
  await page.route(/\/api\/music\/details(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: { item: musicAlbumDetails() } })
  })
  await page.route(/\/api\/indexers\/search(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: { results: [indexerRelease()] } })
  })
}

async function submitSearchFromMusic(page: Page, viewport: { width: number; height: number }, query: string) {
  await page.setViewportSize(viewport)
  await page.goto('/music')
  await expect(page.getByRole('heading', { name: 'Music' })).toBeVisible()
  if (viewport.width < 768) await expectNoHorizontalOverflow(page)

  await submitGlobalSearch(page, query)
  await page.waitForURL((url) => url.pathname === '/music' && url.searchParams.get('q') === query)

  return new URL(page.url())
}

async function submitGlobalSearch(page: Page, query: string) {
  const searchInput = await visibleLocator(page.getByPlaceholder(SEARCH_PLACEHOLDER))
  if (!searchInput) throw new Error('Expected a visible global search input.')

  await expect(searchInput).toBeVisible()
  await searchInput.fill(query)
  await searchInput.press('Enter')
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const viewportWidth = Math.ceil(window.visualViewport?.width ?? window.innerWidth)
        return Math.max(document.documentElement.scrollWidth - viewportWidth, document.body.scrollWidth - viewportWidth)
      }),
    )
    .toBeLessThanOrEqual(0)
}

async function visibleLocator(locator: Locator) {
  const count = await locator.count()
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index)
    if (await candidate.isVisible()) return candidate
  }

  return null
}

function emptyResourcePage() {
  return {
    results: [],
    page: 1,
    totalPages: 1,
    totalResults: 0,
  }
}

const MUSIC_RELEASE_KEY = 'musicbrainz:release-group:89ad4ac3-39f7-470e-963a-56509c546377'
const RELEASE_SEARCH_CONTEXT = 'Music / 1959 / Search query: Kind of Blue Miles Davis 1959 Vinyl'

function musicAlbumDetails() {
  return {
    mediaKey: MUSIC_RELEASE_KEY,
    provider: 'musicbrainz',
    resourceType: 'release-group',
    mbid: '89ad4ac3-39f7-470e-963a-56509c546377',
    releaseGroupMbid: '89ad4ac3-39f7-470e-963a-56509c546377',
    title: 'Kind of Blue',
    artist: 'Miles Davis',
    artists: [{ id: 'artist-1', name: 'Miles Davis', joinPhrase: '' }],
    firstReleaseDate: '1959-08-17',
    releaseYear: '1959',
    releaseDate: '1959-08-17',
    country: 'US',
    primaryType: 'Album',
    secondaryTypes: ['Jazz'],
    disambiguation: null,
    coverArt: { frontUrl: null, frontThumbnailUrl: null, backUrl: null, backThumbnailUrl: null },
    detailMediaKey: 'musicbrainz:release:release-1',
    releaseMbid: 'release-1',
    preferredRelease: null,
    releases: [
      {
        mediaKey: 'musicbrainz:release:release-1',
        mbid: 'release-1',
        title: 'Kind of Blue Legacy',
        date: '1959-08-17',
        country: 'US',
        status: 'Official',
        barcode: null,
        formats: ['Vinyl'],
      },
    ],
    barcode: null,
    aliases: [{ name: 'Blue Sessions', locale: null, primary: false, type: null }],
    formats: ['Vinyl'],
    media: [],
  }
}

function indexerRelease() {
  return {
    id: 'release-1',
    downloadTarget: 'music',
    title: 'Miles Davis Kind of Blue 1959 FLAC',
    fileName: null,
    indexer: 'Prowlarr',
    size: 1024 * 1024 * 700,
    seeders: 42,
    leechers: 1,
    files: 10,
    protocol: 'torrent',
    publishDate: '2026-07-01T00:00:00.000Z',
    downloadUrl: 'https://example.test/kind-of-blue.torrent',
    magnetUrl: null,
    infoUrl: 'https://example.test/release-1',
    infoHash: null,
    categories: ['Audio', 'Lossless'],
    categoryIds: [3000, 3040],
    indexerFlags: [],
    imdbId: null,
    tmdbId: null,
    tvdbId: null,
  }
}
