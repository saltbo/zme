import { zValidator } from '@hono/zod-validator'
import { type MusicFileTags, prepareMusicFile, supportsMusicFileTagging } from '@server/music-tags'
import { fetchNeteaseMusicCover } from '@server/music-tags/cover-loader'
import { MusicDownloadError, resolveMusicTrackDownload } from '@server/usecases/music-downloads'
import type { ResolvedMusicResource } from '@server/usecases/ports'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from './context'
import { idParamsSchema } from './schemas'

const downloadKeyQuerySchema = z.object({
  key: z.string().trim().min(32).max(256),
})

export function registerPublicMusicDownloadRoutes(routes: Hono<AppEnv>) {
  routes.on(
    ['GET', 'HEAD'],
    '/music/tracks/:id/content',
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
        return await deliverMusicResource(
          c.req.method,
          resource,
          filename,
          tags,
          c.env.MUSIC_AUTO_TAGGING_ENABLED === 'true',
        )
      } catch (error) {
        const status = error instanceof MusicDownloadError ? error.status : 502
        return c.json({ error: error instanceof Error ? error.message : 'Music download failed.' }, status)
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

export function inspectMusicResource(resource: ResolvedMusicResource, filename: string): Response {
  const headers = new Headers({
    Location: resource.url,
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Content-Type': resource.contentType ?? contentTypeFor(resource.extension),
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  })
  if (resource.contentLength !== null) headers.set('Content-Length', String(resource.contentLength))
  return new Response(null, { status: 200, headers })
}

export async function deliverMusicResource(
  method: string,
  resource: ResolvedMusicResource,
  filename: string,
  tags: MusicFileTags,
  autoTaggingEnabled: boolean,
): Promise<Response> {
  if (method === 'HEAD') return inspectMusicResource(resource, filename)
  if (!autoTaggingEnabled || !supportsMusicFileTagging(resource.extension)) {
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
  const prepared = await prepareMusicFile(
    upstream.body,
    resource.extension,
    tags,
    upstreamLength,
    fetchNeteaseMusicCover,
  )
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
  const format = extension.toLowerCase()
  if (format === 'flac') return 'audio/flac'
  if (format === 'aac') return 'audio/aac'
  if (format === 'm4a' || format === 'm4b' || format === 'mp4') return 'audio/mp4'
  if (format === 'ogg' || format === 'oga') return 'audio/ogg'
  return 'audio/mpeg'
}
