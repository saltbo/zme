import { InvalidDownloadResourceRefError } from '@server/security/download-resource-ref'
import { InvalidLocalDownloadTicketError, readLocalDownloadTicket } from '@server/security/local-download-ticket'
import { LocalDownloadUnavailableError, localDownloadSecret } from '@server/usecases/local-downloads'
import { MusicDownloadError } from '@server/usecases/music-downloads'
import { ResourceConflictError } from '@server/usecases/resource-errors'
import type { DownloadSourceType, LocalDownload } from '@shared/types'
import type { Hono } from 'hono'
import type { AppEnv } from './context'
import { deliverMusicResource } from './music-downloads'
import { problem } from './protocol'

export function registerPublicLocalDownloadRoutes(routes: Hono<AppEnv>) {
  routes.get('/downloads/:id/content', async (c) => {
    try {
      const source = await readLocalDownloadTicket(localDownloadSecret(c.env), c.req.param('id'))
      if (source.sourceType === 'magnet') return problem(c, 404, 'not-found', 'This source has no file content')
      if (source.sourceType === 'http') {
        if (!source.music) throw new InvalidLocalDownloadTicketError()
        const { resource, tags } = source.music
        const filename = source.filename
        const delivered = await deliverMusicResource(
          'GET',
          resource,
          filename,
          tags,
          c.env.MUSIC_AUTO_TAGGING_ENABLED === 'true',
        )
        if (delivered.status === 200) return delivered
        // The browser must receive the attachment itself, including when no tag rewrite was needed.
        const upstream = await fetch(resource.url, { headers: resource.headers, redirect: 'follow' })
        if (!upstream.ok || !upstream.body) {
          await upstream.body?.cancel()
          throw new LocalDownloadUnavailableError('The music file could not be downloaded.')
        }
        return new Response(upstream.body, {
          headers: fileHeaders(filename, resource.contentType ?? 'application/octet-stream'),
        })
      }
      const bytes = await c.get('deps').downloadSourceContent.torrent(source.uri)
      const headers = fileHeaders(source.filename, 'application/x-bittorrent')
      headers.set('Content-Length', String(bytes.byteLength))
      return new Response(bytes, { headers })
    } catch (error) {
      return localDownloadError(c, error)
    }
  })
}

export function localDownloadRepresentation(
  requestUrl: string,
  source: {
    id: string
    sourceType: DownloadSourceType
    uri: string
    filename: string
    expiresAt: string
    mediaType?: string
  },
): LocalDownload {
  const self = new URL(`/api/downloads/${encodeURIComponent(source.id)}`, requestUrl).toString()
  return {
    id: source.id,
    ...(source.sourceType === 'magnet'
      ? { kind: 'magnet' as const, href: source.uri }
      : {
          kind: 'file' as const,
          href: `${self}/content`,
          filename: source.filename,
          mediaType:
            source.sourceType === 'torrent_url'
              ? 'application/x-bittorrent'
              : (source.mediaType ?? 'application/octet-stream'),
        }),
    expiresAt: source.expiresAt,
    links: { self },
  }
}

function fileHeaders(filename: string, contentType: string) {
  return new Headers({
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Content-Type': contentType,
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  })
}

export function localDownloadError(c: Parameters<typeof problem>[0], error: unknown): Response {
  c.header('Cache-Control', 'private, no-store')
  if (error instanceof InvalidDownloadResourceRefError) return problem(c, 422, 'invalid-resource-ref', error.message)
  if (error instanceof InvalidLocalDownloadTicketError) return problem(c, 410, 'download-source-expired', error.message)
  if (error instanceof ResourceConflictError) return problem(c, 409, 'download-source-unavailable', error.message)
  if (error instanceof MusicDownloadError)
    return problem(c, error.status, 'music-download-unavailable', 'The music download is unavailable')
  if (error instanceof LocalDownloadUnavailableError)
    return problem(c, 502, 'download-source-unavailable', error.message)
  throw error
}
