import { expect, test } from '@playwright/test'

test.describe
  .serial('external OIDC authentication', () => {
    test('logs in through Authorization Code with PKCE, persists the session, and logs out [spec: auth/login-redirect, auth/sign-in, auth/session-persists, auth/sign-out]', async ({
      page,
      context,
    }) => {
      await context.clearCookies()
      await page.goto('/library')
      await expect(page).toHaveURL(/\/login/)

      await page.getByRole('link', { name: 'Continue with identity provider' }).click()
      await page.waitForURL((url) => url.pathname === '/library')
      await expect(page.getByRole('link', { name: 'Continue with identity provider' })).toHaveCount(0)

      const sessionCookie = (await context.cookies()).find((cookie) => cookie.name === '__Host-zme_session')
      expect(sessionCookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' })
      await page.reload()
      await expect(page).toHaveURL((url) => url.pathname === '/library/media')
      await page.getByText('E2E OIDC Admin', { exact: true }).click()
      await page.getByRole('menuitem', { name: 'Sign out' }).click()
      await expect(page).toHaveURL((url) => url.pathname === '/login')
      await page.goto('/library')
      await expect(page).toHaveURL((url) => url.pathname === '/login')
    })

    test('never exposes local registration or password forms [spec: auth/external-only]', async ({ page }) => {
      await page.goto('/login')
      await expect(page.locator('input[type="password"]')).toHaveCount(0)
      await expect(page.getByText(/register|reset password|forgot password/i)).toHaveCount(0)
    })
  })
