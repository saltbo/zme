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
      page.evaluate(() =>
        Math.max(
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
          document.body.scrollWidth - document.body.clientWidth,
        ),
      ),
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
