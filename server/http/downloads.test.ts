import type { Deps } from '@server/usecases/deps'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { AppEnv } from './context'
import { registerDownloadRoutes } from './downloads'

describe('safe download representations', () => {
  it('omits private source URIs and sanitizes upstream result names and failures', async () => {
    const upstream = 'https://private-tracker.test/download?passkey=private'
    const record = {
      id: 'download-1',
      userId: 'owner',
      resourceKind: 'release',
      resourceKey: 'tmdb:movie:550',
      downloaderId: 'downloader-1',
      status: 'completed',
      spec: { sourceType: 'torrent_url', uri: upstream, title: 'Movie' },
      resultName: upstream,
      error: `Upstream failed: ${upstream}`,
    }
    const deps = {
      downloadsRepo: { get: async () => record },
      downloadersRepo: { get: async () => ({ kind: 'qbittorrent' }) },
      downloaderGateways: { qbittorrent: { supportsIdempotentSubmission: false } },
      downloadTaskGateways: {},
    } as unknown as Deps
    const app = new Hono<AppEnv>()
    app.use('*', async (c, next) => {
      c.set('deps', deps)
      c.set('principal', {
        kind: 'agent',
        userId: 'owner',
        issuer: '',
        subject: '',
        role: 'user',
        scopes: ['downloads:read'],
      })
      await next()
    })
    registerDownloadRoutes(app)
    const response = await app.request('/downloads/download-1')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { links: Record<string, string> }
    expect(body).not.toHaveProperty('sourceUri')
    expect(JSON.stringify(body)).not.toContain('private-tracker')
    expect(JSON.stringify(body)).not.toContain('passkey')
    expect(body).toMatchObject({
      monitoringSupported: false,
      pollingRequired: false,
      result: { name: 'Movie' },
      links: { self: expect.any(String) },
    })
    expect(body.links).not.toHaveProperty('suspension')
  })
})
