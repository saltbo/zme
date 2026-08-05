import { expect, type Page, test } from '@playwright/test'

test('active downloads poll REST and stop after reaching a terminal state [spec: downloads/live-task-monitoring]', async ({
  page,
}) => {
  await signIn(page)
  let requests = 0
  let legacyEventsRequested = false
  await page.route('**/api/downloads/events*', async (route) => {
    legacyEventsRequested = true
    await route.abort()
  })
  await page.route(/\/api\/downloads(?:\?.*)?$/, async (route) => {
    requests += 1
    const completed = requests >= 3
    const downloadedBytes = completed ? 1_000 : requests === 1 ? 100 : 250
    await route.fulfill({
      json: {
        items: [download(downloadedBytes, completed)],
        pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
      },
    })
  })

  await page.goto('/downloads')
  await expect(page.getByText('128 B/s · 10%', { exact: true })).toBeVisible()
  await expect(page.getByText('512 B/s · 25%', { exact: true })).toBeVisible({ timeout: 7_000 })
  await expect.poll(() => requests, { timeout: 7_000 }).toBeGreaterThanOrEqual(3)
  await expect(page.getByText('100%', { exact: true })).toBeVisible()
  const terminalRequestCount = requests
  await page.waitForTimeout(6_000)

  expect(requests).toBe(terminalRequestCount)
  expect(legacyEventsRequested).toBe(false)
})

async function signIn(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('zme.language', 'en-US'))
  await page.goto('/login')
  await page.getByRole('link', { name: 'Continue with identity provider' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

function download(downloadedBytes: number, completed: boolean) {
  return {
    id: 'download-1',
    resourceRef: 'release-ref:v1:e2e',
    resourceKind: 'release',
    resourceKey: 'tmdb:movie:550',
    downloaderId: 'zpan-1',
    downloaderName: 'ZPan',
    downloaderKind: 'zpan',
    managementSupported: true,
    sourceType: 'magnet',
    sourceUri: 'magnet:?xt=urn:btih:test',
    name: 'Live Fixture',
    targetFolder: '/media/Movies',
    category: 'zme:movie',
    tags: ['mediaKey=tmdb:movie:550'],
    status: completed ? 'completed' : 'running',
    stage: completed ? null : 'downloading',
    externalTaskId: 'zpan-task-1',
    downstreamStatus: completed ? 'completed' : 'running',
    progress: {
      downloadedBytes,
      storageUploadedBytes: completed ? 1_000 : 0,
      totalBytes: 1_000,
      downloadBps: completed ? 0 : downloadedBytes === 100 ? 128 : 512,
      storageUploadBps: 0,
    },
    result: completed ? { objectId: 'object-1', name: 'Live Fixture', targetFolder: '/media/Movies' } : null,
    error: null,
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: new Date().toISOString(),
    completedAt: completed ? new Date().toISOString() : null,
    links: {},
  }
}
