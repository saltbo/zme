import { readConfig } from '@server/config'
import type { Env } from '@server/env'
import { parseMusicTrackResourceRef, resolveTorrentResourceRef } from '@server/security/download-resource-ref'
import { issueLocalDownloadTicket } from '@server/security/local-download-ticket'
import { sanitizeDownloadPathComponent } from '@shared/download-metadata'
import type { Deps } from './deps'
import { resolveDownloadSource } from './downloaders'
import { resolveLocalMusicDownload } from './music-downloads'
import { ResourceConflictError } from './resource-errors'

export async function prepareLocalDownload(deps: Deps, env: Env, userId: string, resourceRef: string) {
  const secret = localDownloadSecret(env)
  const musicKey = parseMusicTrackResourceRef(resourceRef)
  if (musicKey) {
    const { filename, resource, tags } = await resolveLocalMusicDownload(deps, env, userId, musicKey)
    const ticket = await issueLocalDownloadTicket(secret, {
      userId,
      resourceRef,
      sourceType: 'http',
      uri: '',
      filename,
      mediaType: resource.contentType ?? 'application/octet-stream',
      music: { resource, tags },
    })
    return {
      ...ticket,
      sourceType: 'http' as const,
      uri: '',
      filename,
      mediaType: resource.contentType ?? 'application/octet-stream',
    }
  }
  const release = await resolveTorrentResourceRef(secret, userId, resourceRef)
  let source: Awaited<ReturnType<typeof resolveDownloadSource>>
  try {
    source = await resolveDownloadSource(deps, release)
  } catch (cause) {
    throw new LocalDownloadUnavailableError('The local download source could not be resolved.', { cause })
  }
  if (!URL.canParse(source.uri)) throw new ResourceConflictError('The resource has no supported local download source.')
  const uri = new URL(source.uri)
  if (source.sourceType === 'magnet' ? uri.protocol !== 'magnet:' : !['http:', 'https:'].includes(uri.protocol)) {
    throw new ResourceConflictError('The resource has no supported local download source.')
  }
  const filename = `${sanitizeDownloadPathComponent(release.title.replace(/\.torrent$/i, ''), 'release', 180)}.torrent`
  const ticket = await issueLocalDownloadTicket(secret, {
    userId,
    resourceRef: '',
    sourceType: source.sourceType,
    uri: source.uri,
    filename,
  })
  return { ...ticket, sourceType: source.sourceType, uri: source.sourceType === 'magnet' ? source.uri : '', filename }
}

export class LocalDownloadUnavailableError extends Error {}

export function localDownloadSecret(env: Env): string {
  const secret = readConfig(env).downloadResourceRefSecret
  if (!secret) throw new Error('DOWNLOAD_RESOURCE_REF_SECRET is required.')
  return secret
}
