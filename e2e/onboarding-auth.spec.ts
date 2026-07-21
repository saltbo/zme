import { expect, test } from '@playwright/test'

// The DB is reset on server boot, so the suite owns its state and runs in order:
// these cover the cross-stack seams (real SPA + Worker + D1 + better-auth session)
// with no external dependency.
const ADMIN = { name: 'E2E Admin', email: 'e2e-admin@zme.test', password: 'e2e-password-123' }

test.describe
  .serial('onboarding and auth', () => {
    test('first run routes to onboarding and creates the first admin', async ({ page }) => {
      await page.goto('/')
      await expect(page).toHaveURL(/\/onboarding/)

      await page.fill('#setup-name', ADMIN.name)
      await page.fill('#setup-email', ADMIN.email)
      await page.fill('#setup-password', ADMIN.password)
      await page.getByRole('button', { name: 'Create administrator' }).click()

      // Advancing to the media-source step proves the admin was created (201).
      await expect(page.locator('#setup-tmdb-api-key')).toBeVisible()
    })

    test('setup is locked once initialized [spec: onboarding/locked-after-init]', async ({ page }) => {
      await page.goto('/onboarding')
      // Re-running onboarding from scratch is no longer offered: the admin step is gone.
      await expect(page.locator('#setup-name')).toHaveCount(0)
    })

    test('a logged-out visitor is sent to login and can sign in [spec: auth/login-redirect, auth/sign-in]', async ({
      page,
      context,
    }) => {
      await context.clearCookies()

      await page.goto('/library')
      await expect(page).toHaveURL(/\/login/)

      await page.fill('#login-email', ADMIN.email)
      await page.fill('#login-password', ADMIN.password)
      await page.getByRole('button', { name: 'Sign in' }).click()

      // Authenticated: the login form is gone and we are no longer on /login.
      await expect(page).not.toHaveURL(/\/login/)
      await expect(page.locator('#login-email')).toHaveCount(0)
    })

    test('the session survives a reload [spec: auth/session-persists]', async ({ page }) => {
      await page.goto('/')
      await expect(page.locator('#login-email')).toHaveCount(0)
      await page.reload()
      await expect(page).not.toHaveURL(/\/login/)
      await expect(page.locator('#login-email')).toHaveCount(0)
    })

    test('bad credentials are rejected [spec: auth/reject-bad-credentials]', async ({ page, context }) => {
      await context.clearCookies()
      await page.goto('/login')
      await page.fill('#login-email', ADMIN.email)
      await page.fill('#login-password', 'wrong-password-123')
      await page.getByRole('button', { name: 'Sign in' }).click()

      await expect(page).toHaveURL(/\/login/)
    })

    test('Netease connector offers SMS verification login [spec: connectors/netease-sms-login]', async ({ page }) => {
      await page.goto('/login')
      await page.fill('#login-email', ADMIN.email)
      await page.fill('#login-password', ADMIN.password)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page).not.toHaveURL(/\/login/)

      await page.goto('/settings')
      const neteaseCard = page.getByText('Netease Cloud Music', { exact: true }).locator('../../..')
      await neteaseCard.getByRole('button', { name: 'Connect' }).click()

      const dialog = page.getByRole('dialog', { name: 'Netease Cloud Music' })
      await dialog.getByRole('button', { name: 'SMS code' }).click()
      await expect(dialog.locator('#netease-country-code')).toHaveValue('86')
      await expect(dialog.locator('#netease-phone')).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Send verification code' })).toBeDisabled()
      await expect(dialog.getByText(/not your phone number or verification code/i)).toBeVisible()

      const verificationAttempt = {
        id: '11111111-1111-4111-8111-111111111111',
        kind: 'netease',
        qrUrl: 'https://st.music.163.com/encrypt-pages?qrCode=risk-qr-code',
        status: 'waiting_scan',
        expiresAt: '2026-07-21T00:00:00.000Z',
      }
      await page.route('**/api/connectors/netease/sms-codes', (route) => route.fulfill({ json: { sent: true } }))
      await page.route('**/api/connectors/netease/sms-login', (route) =>
        route.fulfill({ json: { connector: null, verification: verificationAttempt } }),
      )
      await page.route('**/api/connectors/netease/login-attempts/*/check', (route) =>
        route.fulfill({ json: { attempt: verificationAttempt, connector: null } }),
      )

      await dialog.locator('#netease-phone').fill('13800138000')
      await dialog.getByRole('button', { name: 'Send verification code' }).click()
      await dialog.locator('#netease-sms-code').fill('1234')
      await dialog.getByRole('button', { name: 'Connect' }).click()

      await expect(dialog.getByText('Account verification required')).toBeVisible()
      await expect(dialog.getByText(/scan with the Netease Cloud Music app/i)).toBeVisible()
    })

    test('Netease QR login displays an account verification challenge', async ({ page }) => {
      await page.goto('/login')
      await page.fill('#login-email', ADMIN.email)
      await page.fill('#login-password', ADMIN.password)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page).not.toHaveURL(/\/login/)

      const loginAttempt = {
        id: '22222222-2222-4222-8222-222222222222',
        kind: 'netease',
        qrUrl: 'https://music.163.com/login?codekey=login-key',
        status: 'waiting_scan',
        expiresAt: '2099-07-21T00:00:00.000Z',
      }
      const verificationAttempt = {
        ...loginAttempt,
        qrUrl: 'https://st.music.163.com/encrypt-pages?qrCode=risk-qr-code',
      }
      await page.route('**/api/connectors/netease/login-attempts', (route) =>
        route.fulfill({ json: { item: loginAttempt } }),
      )
      await page.route('**/api/connectors/netease/login-attempts/*/check', (route) =>
        route.fulfill({ json: { attempt: verificationAttempt, connector: null } }),
      )

      await page.goto('/settings')
      const neteaseCard = page.getByText('Netease Cloud Music', { exact: true }).locator('../../..')
      await neteaseCard.getByRole('button', { name: 'Connect' }).click()
      const dialog = page.getByRole('dialog', { name: 'Netease Cloud Music' })
      await dialog.getByRole('button', { name: 'Generate login QR code' }).click()

      await expect(dialog.getByText('Account verification required')).toBeVisible()
      await expect(dialog.getByText(/signed in to the same account/i)).toBeVisible()
    })

    test('playlist selection remains a draft until one asynchronous save', async ({ page }) => {
      const setup = await page.request.post('/api/setup/admin', { data: ADMIN })
      expect([201, 409]).toContain(setup.status())
      await page.goto('/login')
      await page.fill('#login-email', ADMIN.email)
      await page.fill('#login-password', ADMIN.password)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page).not.toHaveURL(/\/login/)

      const connectorId = '33333333-3333-4333-8333-333333333333'
      const firstPlaylistId = '44444444-4444-4444-8444-444444444444'
      const secondPlaylistId = '55555555-5555-4555-8555-555555555555'
      const selectedIds = new Set([secondPlaylistId])
      const selectionRequests: Array<{ selectedPlaylistIds: string[] }> = []
      const connector = {
        id: connectorId,
        kind: 'netease',
        displayName: 'Fixture listener',
        avatarUrl: null,
        externalAccountId: 'fixture-account',
        authModes: ['qr', 'sms'],
        capabilities: ['music.playlists.read', 'music.tracks.download'],
        status: 'connected',
        enabled: true,
        lastSyncedAt: null,
        lastError: null,
        lastResult: null,
        createdAt: '2026-07-21T00:00:00.000Z',
        updatedAt: '2026-07-21T00:00:00.000Z',
      }
      const playlists = [
        playlistFixture(firstPlaylistId, 'Playlist One', false),
        playlistFixture(secondPlaylistId, 'Playlist Two', true),
      ]

      await page.route('**/api/connectors', (route) => route.fulfill({ json: { items: [connector] } }))
      await page.route(`**/api/connectors/${connectorId}/playlists`, async (route) => {
        if (route.request().method() === 'PUT') {
          const input = route.request().postDataJSON() as { selectedPlaylistIds: string[] }
          selectionRequests.push(input)
          selectedIds.clear()
          for (const id of input.selectedPlaylistIds) selectedIds.add(id)
          await route.fulfill({ status: 202, json: { selectedPlaylists: selectedIds.size } })
          return
        }
        await route.fulfill({
          json: {
            items: playlists.map((playlist) => ({
              ...playlist,
              libraryAddedAt: selectedIds.has(playlist.id) ? '2026-07-21T00:00:00.000Z' : null,
            })),
          },
        })
      })

      await page.goto('/settings')
      await page.getByRole('button', { name: 'Manage playlists' }).click()
      let dialog = page.getByRole('dialog', { name: 'Netease Cloud Music' })
      let firstPlaylistSwitch = dialog.getByText('Playlist One', { exact: true }).locator('../..').getByRole('switch')
      await expect(firstPlaylistSwitch).not.toBeChecked()
      await firstPlaylistSwitch.click()
      await expect(firstPlaylistSwitch).toBeChecked()
      expect(selectionRequests).toHaveLength(0)

      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await page.getByRole('button', { name: 'Manage playlists' }).click()
      dialog = page.getByRole('dialog', { name: 'Netease Cloud Music' })
      firstPlaylistSwitch = dialog.getByText('Playlist One', { exact: true }).locator('../..').getByRole('switch')
      await expect(firstPlaylistSwitch).not.toBeChecked()
      expect(selectionRequests).toHaveLength(0)

      await firstPlaylistSwitch.click()
      await dialog.getByRole('button', { name: 'Save' }).click()
      await expect(page.getByText('Playlist selection saved and sync queued')).toBeVisible()
      await expect(dialog).not.toBeVisible()
      expect(selectionRequests).toEqual([{ selectedPlaylistIds: [secondPlaylistId, firstPlaylistId] }])
    })
  })

function playlistFixture(id: string, title: string, selected: boolean) {
  return {
    id,
    kind: 'playlist',
    provider: 'netease',
    externalId: id,
    title,
    description: null,
    coverUrl: null,
    ownerName: 'Fixture listener',
    trackCount: 2,
    libraryAddedAt: selected ? '2026-07-21T00:00:00.000Z' : null,
    remoteUpdatedAt: null,
    lastSyncedAt: null,
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
  }
}
