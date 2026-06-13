import type { ConnectorConfig, DownloaderGateway, DownloadTaskOwner } from '@server/usecases/ports'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, stubFetch } from './test-support'
import { zpanDownloaderGateway, zpanDownloadTaskGateway } from './zpan'

const config: ConnectorConfig = {
  endpoint: 'http://zpan.local',
  credentials: { apiKey: 'zpan-key' },
  options: { targetFolder: '/media' },
}

const owner: DownloadTaskOwner = {
  downloaderId: 'dl-1',
  downloaderName: 'My ZPan',
  downloaderKind: 'zpan',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('zpanDownloaderGateway', () => {
  it('creates a download task with normalized category and typed target folder', async () => {
    const calls = stubFetch(() => jsonResponse({ id: 'task-1' }))

    const input: Parameters<DownloaderGateway['submit']>[1] = {
      downloaderId: 'dl-1',
      uri: 'magnet:?xt=urn:btih:abc',
      sourceType: 'magnet',
      title: 'Some Movie',
      category: 'movie',
      tags: ['hd'],
    }
    await zpanDownloaderGateway.submit(config, input)

    expect(calls).toHaveLength(1)
    expect(`${calls[0].method} ${calls[0].url.href}`).toBe('POST http://zpan.local/api/download-tasks')
    expect(calls[0].headers.get('authorization')).toBe('Bearer zpan-key')
    expect(JSON.parse(calls[0].body ?? '')).toEqual({
      source: { type: 'magnet', uri: 'magnet:?xt=urn:btih:abc' },
      targetFolder: '/media/Movies',
      name: 'Some Movie',
      category: 'zme:movie',
      tags: ['hd'],
    })
  })

  it('probes the health endpoint', async () => {
    const calls = stubFetch(() => jsonResponse({ ok: true }))

    await zpanDownloaderGateway.probe(config)

    expect(calls[0].url.href).toBe('http://zpan.local/api/health')
  })
})

describe('zpanDownloadTaskGateway', () => {
  it('maps zme statuses to zpan statuses in the query and back in the result', async () => {
    const calls = stubFetch(() =>
      jsonResponse({
        items: [
          {
            id: 'task-1',
            spec: {
              source: { type: 'magnet', uri: 'magnet:?xt=urn:btih:abc' },
              destination: { name: '', folder: '/media/Movies' },
              labels: { category: 'zme:movie', tags: [] },
            },
            status: {
              state: 'downloading',
              progress: {
                download: { bytes: 10, totalBytes: 100, bytesPerSecond: 5 },
                upload: { bytes: 1, bytesPerSecond: 2 },
              },
              runtime: { torrent: { name: 'Runtime Name' } },
            },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
    )

    const page = await zpanDownloadTaskGateway.list(config, owner, { status: 'running', page: 1, pageSize: 20 })

    expect(calls[0].url.pathname).toBe('/api/download-tasks')
    expect(calls[0].url.searchParams.get('status')).toBe('downloading')

    expect(page.total).toBe(1)
    expect(page.items[0]).toMatchObject({
      id: 'task-1',
      downloaderId: 'dl-1',
      downloaderName: 'My ZPan',
      downloaderKind: 'zpan',
      name: 'Runtime Name',
      status: 'running',
      downloadedBytes: 10,
      totalBytes: 100,
    })
  })
})
