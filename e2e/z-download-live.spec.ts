import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, type Page, test } from '@playwright/test'

const BASE_URL = 'http://localhost:7171'
const ADMIN = {
  name: process.env.LOCAL_TEST_NAME ?? 'E2E Admin',
  email: process.env.LOCAL_TEST_EMAIL ?? 'e2e-admin@zme.test',
  password: process.env.LOCAL_TEST_PASSWORD ?? 'e2e-password-123',
}

test('live download cards follow timed SSE snapshots in all and running views [spec: downloads/live-task-monitoring]', async ({
  page,
}) => {
  const fixture = await startZpanFixture()
  const observed: string[] = []

  try {
    await signIn(page)
    await replaceDownloaders(page, fixture.url)

    await page.goto('/downloads')
    await observeCard(page, observed, 'All initial', '128 B/s · 10%')
    await observeCard(page, observed, 'All snapshot 1', '512 B/s · 25%')
    await observeCard(page, observed, 'All snapshot 2', '2.0 KB/s · 75%')

    await page.getByRole('button', { name: 'Downloading' }).click()
    await observeCard(page, observed, 'Running initial', '2.0 KB/s · 75%')
    await observeCard(page, observed, 'Running snapshot 1', '4.0 KB/s · 80%')
    await observeCard(page, observed, 'Running snapshot 2', '8.0 KB/s · 90%')

    test.info().annotations.push({ type: 'acceptance-observed', description: observed.join(' -> ') })
  } finally {
    await fixture.close()
  }
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

async function replaceDownloaders(page: Page, endpoint: string) {
  const existingResponse = await page.request.get('/api/downloaders')
  await expect(existingResponse).toBeOK()
  const existing = (await existingResponse.json()) as { items: Array<{ id: string }> }
  for (const item of existing.items) {
    const deleted = await page.request.delete(`/api/downloaders/${item.id}`)
    await expect(deleted).toBeOK()
  }

  const created = await page.request.post('/api/downloaders', {
    data: {
      description: 'Timed ZPan SSE fixture',
      kind: 'zpan',
      endpoint,
      credentials: { apiKey: 'fixture-key' },
      options: { targetFolder: '/media' },
      enabled: true,
    },
  })
  expect(created.status()).toBe(201)
}

async function observeCard(page: Page, observed: string[], label: string, value: string) {
  await expect(page.getByText(value, { exact: true })).toBeVisible()
  observed.push(`${label}: ${value}`)
}

async function startZpanFixture(): Promise<{ url: string; close: () => Promise<void> }> {
  let current = liveTask(100, 128)
  let streamCount = 0

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://fixture.local')
    if (request.headers.authorization !== 'Bearer fixture-key') {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Unauthorized' } }))
      return
    }

    if (url.pathname === '/api/downloads/tasks') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ items: [current], total: 1, page: 1, pageSize: 20 }))
      return
    }

    if (url.pathname === '/api/events' && url.searchParams.get('downloadTasks') === '1') {
      streamCount += 1
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      response.flushHeaders()

      const snapshots =
        streamCount === 1 ? [liveTask(250, 512), liveTask(750, 2_048)] : [liveTask(800, 4_096), liveTask(900, 8_192)]
      const timers = snapshots.map((snapshot, index) =>
        setTimeout(
          () => {
            current = snapshot
            response.write(
              `event: download-tasks\ndata: ${JSON.stringify({ items: [snapshot], total: 1, page: 1, pageSize: 20 })}\n\n`,
            )
          },
          index === 0 ? 1_500 : 3_500,
        ),
      )
      response.on('close', () => {
        for (const timer of timers) clearTimeout(timer)
      })
      return
    }

    response.writeHead(404)
    response.end()
  })

  await listen(server)
  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

function listen(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
}

function liveTask(downloadedBytes: number, downloadBps: number) {
  return {
    id: 'live-task-1',
    spec: {
      source: { type: 'magnet', uri: 'magnet:?xt=urn:btih:live-task-1' },
      destination: { name: 'Live Fixture', folder: '/media/Movies' },
      labels: { category: 'zme:movie', tags: [] },
    },
    status: {
      state: 'downloading',
      attempt: 1,
      assignment: { downloaderId: 'fixture-worker' },
      progress: {
        download: { bytes: downloadedBytes, totalBytes: 1_000, bytesPerSecond: downloadBps },
        upload: { bytes: 0, totalBytes: 1_000, bytesPerSecond: 0 },
      },
      billing: { state: 'ok', authorizedBytes: 1_000, chargedBytes: 0, chargedCredits: 0 },
      output: { objectId: '' },
      runtime: {},
      error: { message: '' },
    },
  }
}
