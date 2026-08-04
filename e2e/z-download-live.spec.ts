import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, type Page, test } from '@playwright/test'

test('one live stream reconciles task changes across views [spec: downloads/live-task-monitoring]', async ({
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
    await expect(page.getByText('Live Fixture B', { exact: true })).toBeVisible()
    await observeCard(page, observed, 'All snapshot 2', '2.0 KB/s · 75%')

    await page.getByRole('button', { name: 'Downloading' }).click()
    await observeCard(page, observed, 'Running initial', '2.0 KB/s · 75%')
    await observeCard(page, observed, 'Running snapshot 1', '4.0 KB/s · 80%')
    await expect(page.getByText('Live Fixture B', { exact: true })).not.toBeVisible()

    await page.getByRole('button', { name: 'All' }).click()
    await observeCard(page, observed, 'All snapshot 3', '8.0 KB/s · 90%')
    await expect(page.getByText('Live Fixture B', { exact: true })).not.toBeVisible()
    expect(fixture.streamCount()).toBe(1)

    test.info().annotations.push({ type: 'acceptance-observed', description: observed.join(' -> ') })
  } finally {
    await fixture.close()
  }
})

async function signIn(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('zme.language', 'en-US'))
  await page.goto('/login')
  await page.getByRole('link', { name: 'Continue with identity provider' }).click()
  await expect(page).not.toHaveURL(/\/login/)
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

async function startZpanFixture(): Promise<{ url: string; streamCount: () => number; close: () => Promise<void> }> {
  let current = [liveTask('live-task-1', 'Live Fixture', 'downloading', 100, 128)]
  let streamCount = 0

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://fixture.local')
    if (request.headers.authorization !== 'Bearer fixture-key') {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Unauthorized' } }))
      return
    }

    if (url.pathname === '/api/downloads/tasks') {
      const status = url.searchParams.get('status')
      const items = status ? current.filter((task) => task.status.state === status) : current
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ items, total: items.length, page: 1, pageSize: 50 }))
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

      const snapshots = [
        [
          liveTask('live-task-1', 'Live Fixture', 'downloading', 250, 512),
          liveTask('live-task-2', 'Live Fixture B', 'downloading', 200, 1_024),
        ],
        [
          liveTask('live-task-1', 'Live Fixture', 'downloading', 750, 2_048),
          liveTask('live-task-2', 'Live Fixture B', 'downloading', 500, 1_024),
        ],
        [
          liveTask('live-task-1', 'Live Fixture', 'downloading', 800, 4_096),
          liveTask('live-task-2', 'Live Fixture B', 'completed', 1_000, 0),
        ],
        [liveTask('live-task-1', 'Live Fixture', 'downloading', 900, 8_192)],
      ]
      const timers = snapshots.map((snapshot, index) =>
        setTimeout(
          () => {
            current = snapshot
            response.write(
              `event: download-tasks\ndata: ${JSON.stringify({ items: snapshot, total: snapshot.length, page: 1, pageSize: 50 })}\n\n`,
            )
          },
          1_500 + index * 2_000,
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
    streamCount: () => streamCount,
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

function liveTask(
  id: string,
  name: string,
  state: 'downloading' | 'completed',
  downloadedBytes: number,
  downloadBps: number,
) {
  return {
    id,
    spec: {
      source: { type: 'magnet', uri: `magnet:?xt=urn:btih:${id}` },
      destination: { name, folder: '/media/Movies' },
      labels: { category: 'zme:movie', tags: [] },
    },
    status: {
      state,
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
