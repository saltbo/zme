import { zValidator } from '@hono/zod-validator'
import { type MusicFileCover, type MusicFileTags, prepareMusicFile } from '@server/domain/music-file-tags'
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

const MAX_MUSIC_COVER_BYTES = 5 * 1024 * 1024

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
  const prepared = await prepareMusicFile(upstream.body, resource.extension, tags, upstreamLength, fetchMusicCover)
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

async function fetchMusicCover(value: string): Promise<MusicFileCover> {
  const url = normalizeNeteaseCoverUrl(value)
  const response = await fetch(url, {
    headers: {
      Referer: 'https://music.163.com/',
      'User-Agent': 'Mozilla/5.0 ZME/0.0.1',
    },
    redirect: 'error',
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`Music cover returned HTTP ${response.status}.`)
  }
  const declaredLength = parseContentLength(response.headers.get('content-length'))
  if (declaredLength !== null && declaredLength > MAX_MUSIC_COVER_BYTES) {
    await response.body?.cancel()
    throw new Error(`Music cover exceeds ${MAX_MUSIC_COVER_BYTES} bytes.`)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_MUSIC_COVER_BYTES) {
    throw new Error(`Music cover exceeds ${MAX_MUSIC_COVER_BYTES} bytes.`)
  }
  return { mimeType: detectCoverMimeType(bytes), bytes }
}

function normalizeNeteaseCoverUrl(value: string): URL {
  const url = new URL(value)
  const hostname = url.hostname.toLowerCase()
  const trustedHost =
    hostname === 'music.126.net' ||
    hostname.endsWith('.music.126.net') ||
    hostname === 'music.163.com' ||
    hostname.endsWith('.music.163.com')
  if (!trustedHost || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new Error('Netease returned an untrusted cover URL.')
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new Error('Netease returned an untrusted cover URL.')
  }
  url.protocol = 'https:'
  url.port = ''
  url.username = ''
  url.password = ''
  return url
}

function detectCoverMimeType(bytes: Uint8Array): MusicFileCover['mimeType'] {
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  throw new Error('Music cover is not a supported JPEG, PNG, or WebP image.')
}
