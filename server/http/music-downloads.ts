import { zValidator } from '@hono/zod-validator'
import {
  MusicDownloadError,
  resolveMusicTrackDownload,
  submitMusicTrackDownload,
} from '@server/usecases/music-downloads'
import type { ResolvedMusicResource } from '@server/usecases/ports'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from './context'
import { idParamsSchema } from './schemas'

const downloadKeyQuerySchema = z.object({
  key: z.string().trim().min(32).max(256),
})

const submitMusicDownloadSchema = z.object({
  downloaderId: z.string().trim().min(1),
  quality: z.enum(['standard', 'exhigh', 'lossless', 'hires']).optional(),
})

export function registerPublicMusicDownloadRoutes(routes: Hono<AppEnv>) {
  routes.on(
    ['GET', 'HEAD'],
    '/music/tracks/:id/download',
    zValidator('param', idParamsSchema),
    zValidator('query', downloadKeyQuerySchema),
    async (c) => {
      try {
        const { resource, filename } = await resolveMusicTrackDownload(
          c.get('deps'),
          c.env,
          c.req.valid('param').id,
          c.req.valid('query').key,
        )
        return await proxyMusicResource(c.req.raw, resource, filename)
      } catch (error) {
        const status = error instanceof MusicDownloadError ? error.status : 502
        return c.json({ error: error instanceof Error ? error.message : 'Music download failed.' }, status)
      }
    },
  )
}

export function registerMusicDownloadRoutes(routes: Hono<AppEnv>) {
  routes.post(
    '/music/tracks/:id/download',
    zValidator('param', idParamsSchema),
    zValidator('json', submitMusicDownloadSchema),
    async (c) => {
      try {
        const item = await submitMusicTrackDownload(
          c.get('deps'),
          c.get('user').id,
          c.req.valid('param').id,
          c.req.valid('json'),
          new URL(c.req.url).origin,
        )
        return c.json({ item }, 201)
      } catch (error) {
        const status = error instanceof MusicDownloadError ? error.status : 502
        return c.json({ error: error instanceof Error ? error.message : 'Music download submission failed.' }, status)
      }
    },
  )
}

export async function proxyMusicResource(
  request: Request,
  resource: ResolvedMusicResource,
  filename: string,
): Promise<Response> {
  const headers = new Headers(resource.headers)
  headers.set('accept-encoding', 'identity')
  copyHeader(request.headers, headers, 'range')
  copyHeader(request.headers, headers, 'if-range')

  const upstream = await fetch(resource.url, {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers,
    redirect: 'error',
  })
  if (!upstream.ok && upstream.status !== 416) {
    await upstream.body?.cancel()
    throw new MusicDownloadError(`Music provider returned HTTP ${upstream.status}.`, 502)
  }

  const responseHeaders = new Headers()
  for (const name of ['accept-ranges', 'content-length', 'content-range', 'content-type', 'etag', 'last-modified']) {
    copyHeader(upstream.headers, responseHeaders, name)
  }
  if (!responseHeaders.has('content-type') && resource.contentType) {
    responseHeaders.set('content-type', resource.contentType)
  }
  if (!responseHeaders.has('content-length') && !request.headers.has('range') && resource.contentLength !== null) {
    responseHeaders.set('content-length', String(resource.contentLength))
  }
  responseHeaders.set('content-disposition', contentDisposition(filename))
  responseHeaders.set('cache-control', 'private, no-store')
  responseHeaders.set('referrer-policy', 'no-referrer')
  responseHeaders.set('x-content-type-options', 'nosniff')

  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  })
}

function copyHeader(source: Headers, target: Headers, name: string): void {
  const value = source.get(name)
  if (value !== null) target.set(name, value)
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replaceAll('"', '_')
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, (value) => `%${value.charCodeAt(0).toString(16)}`)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}
