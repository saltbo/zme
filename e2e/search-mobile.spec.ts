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
        await page.goto(BOOK_RELEASE_PATH)

        await expect(page.getByRole('heading', { name: 'Matilda', exact: true })).toBeVisible()
        await expect(page.getByText(RELEASE_SEARCH_CONTEXT)).toBeVisible()
        expect(await visibleLocator(page.getByPlaceholder('Filter titles or indexers'))).toBeNull()
        await expect(page.getByText('Roald Dahl Matilda 1988 EPUB')).toBeVisible()
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
    await page.goto(BOOK_RELEASE_PATH)

    await expect(page.getByRole('heading', { name: 'Matilda', exact: true })).toBeVisible()
    await expect(page.getByText(RELEASE_SEARCH_CONTEXT)).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByPlaceholder('Filter titles or indexers')).toBeVisible()
    const resultSummary = await visibleLocator(page.getByText('Showing 1 / 1 results'))
    if (!resultSummary) throw new Error('Expected a visible result summary in the page toolbar.')
    await expect(resultSummary).toBeVisible()
    await expect(page.getByText('Roald Dahl Matilda 1988 EPUB')).toBeVisible()
    await expect(page.getByRole('button', { name: 'No downloaders' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })

  test('release search app back returns to book detail without leaving release search behind', async ({ page }) => {
    await signIn(page)
    await stubResourceSearchApis(page)
    await stubReleaseSearchApis(page)

    for (const viewport of [DESKTOP_VIEWPORT, ...MOBILE_VIEWPORTS]) {
      await test.step(`back stack from ${viewport.width}px`, async () => {
        await page.setViewportSize(viewport)
        await page.goto('/books')
        await expect(page.getByRole('heading', { name: 'Books' })).toBeVisible()
        await page.goto(BOOK_DETAIL_PATH)
        await expect(bookDetailHeading(page)).toBeVisible()

        await page.getByRole('button', { name: 'Search downloads' }).click()
        await page.getByRole('menuitem', { name: 'Ebook' }).click()
        await page.waitForURL((url) => url.pathname === BOOK_RELEASE_PATH)
        await expect(page.getByText(RELEASE_SEARCH_CONTEXT)).toBeVisible()

        await page.getByRole('button', { name: 'Back' }).click()
        await page.waitForURL((url) => url.pathname === BOOK_DETAIL_PATH)
        await expect(bookDetailHeading(page)).toBeVisible()

        await page.goBack()
        await page.waitForURL((url) => url.pathname === '/books')
        expect(new URL(page.url()).pathname).toBe('/books')
      })
    }
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
  await page.route(/\/api\/books\/(?:discover|search)(?:\?.*)?$/, async (route) => {
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
  await page.route(/\/api\/books\/[^/?]+(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: { item: bookDetails() } })
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

function bookDetailHeading(page: Page) {
  return page.getByRole('heading', { name: 'Matilda', exact: true }).last()
}

function emptyResourcePage() {
  return {
    results: [],
    page: 1,
    totalPages: 1,
    totalResults: 0,
  }
}

const BOOK_RELEASE_KEY = 'openlibrary:work:OL45883W'
const BOOK_DETAIL_PATH = `/books/${encodeURIComponent(BOOK_RELEASE_KEY)}`
const BOOK_RELEASE_PATH = `${BOOK_DETAIL_PATH}/releases/ebook`
const RELEASE_SEARCH_CONTEXT = 'Ebook / 1988 / Search query: Matilda Roald Dahl 1988 ebook'

function bookDetails() {
  return {
    mediaKey: BOOK_RELEASE_KEY,
    title: 'Matilda',
    authors: ['Roald Dahl'],
    languages: ['eng'],
    firstPublishYear: 1988,
    coverUrl: null,
    isbnCandidates: ['9780140328721'],
    editionKeys: ['OL7353617M'],
    aliases: ['Matilda, or, The Child Genius'],
    description: 'A clever child loves books.',
    covers: [],
    workKey: BOOK_RELEASE_KEY,
    editionKey: 'openlibrary:edition:OL7353617M',
    editionCandidates: [],
  }
}

function indexerRelease() {
  return {
    id: 'release-1',
    downloadTarget: 'ebook',
    title: 'Roald Dahl Matilda 1988 EPUB',
    fileName: null,
    indexer: 'Prowlarr',
    size: 1024 * 1024 * 700,
    seeders: 42,
    leechers: 1,
    files: 10,
    protocol: 'torrent',
    publishDate: '2026-07-01T00:00:00.000Z',
    downloadUrl: 'https://example.test/matilda.torrent',
    magnetUrl: null,
    infoUrl: 'https://example.test/release-1',
    infoHash: null,
    categories: ['Books', 'Ebook'],
    categoryIds: [7000, 7020],
    indexerFlags: [],
    imdbId: null,
    tmdbId: null,
    tvdbId: null,
  }
}
