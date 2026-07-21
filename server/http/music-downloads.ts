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
        return redirectMusicResource(resource, filename)
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
          c.env,
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

export function redirectMusicResource(resource: ResolvedMusicResource, filename: string): Response {
  return new Response(null, {
    status: 307,
    headers: {
      Location: resource.url,
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
