import { zValidator } from '@hono/zod-validator'
import { type MusicFileTags, prepareMusicFile } from '@server/domain/music-file-tags'
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
  releaseId: z.string().trim().min(1).optional(),
  quality: z.enum(['standard', 'exhigh', 'lossless', 'hires']).optional(),
  force: z.boolean().optional(),
})

export function registerPublicMusicDownloadRoutes(routes: Hono<AppEnv>) {
  routes.on(
    ['GET', 'HEAD'],
    '/music/tracks/:id/download',
    zValidator('param', idParamsSchema),
    zValidator('query', downloadKeyQuerySchema),
    async (c) => {
      try {
        const { resource, filename, tags } = await resolveMusicTrackDownload(
          c.get('deps'),
          c.env,
          c.req.valid('param').id,
          c.req.valid('query').key,
        )
        return deliverMusicResource(c.req.method, resource, filename, tags, c.env.MUSIC_AUTO_TAGGING_ENABLED === 'true')
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
        )
        return c.json({ item }, 202)
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

export async function deliverMusicResource(
  method: string,
  resource: ResolvedMusicResource,
  filename: string,
  tags: MusicFileTags,
  autoTaggingEnabled: boolean,
): Promise<Response> {
  if (!autoTaggingEnabled || method === 'HEAD' || !['mp3', 'flac'].includes(resource.extension.toLowerCase())) {
    return redirectMusicResource(resource, filename)
  }

  const upstream = await fetch(resource.url, {
    headers: resource.headers,
    redirect: 'follow',
  })
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel()
    throw new Error(`Music resource returned HTTP ${upstream.status}.`)
  }

  const upstreamLength = parseContentLength(upstream.headers.get('content-length')) ?? resource.contentLength
  const prepared = await prepareMusicFile(upstream.body, resource.extension, tags, upstreamLength)
  if (!prepared.changed || !prepared.body) return redirectMusicResource(resource, filename)

  const body =
    prepared.contentLength === null ? prepared.body : pipeToFixedLengthStream(prepared.body, prepared.contentLength)
  return new Response(body, {
    status: 200,
    headers: {
      'Accept-Ranges': 'none',
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Type':
        resource.contentType ?? upstream.headers.get('content-type') ?? contentTypeFor(resource.extension),
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function pipeToFixedLengthStream(body: ReadableStream<Uint8Array>, length: number): ReadableStream<Uint8Array> {
  const { readable, writable } = new FixedLengthStream(length)
  void body.pipeTo(writable)
  return readable
}

function parseContentLength(value: string | null): number | null {
  if (value === null) return null
  const length = Number(value)
  return Number.isSafeInteger(length) && length >= 0 ? length : null
}

function contentTypeFor(extension: string): string {
  return extension.toLowerCase() === 'flac' ? 'audio/flac' : 'audio/mpeg'
}
