import type { MusicFileTags } from '@server/music-tags'
import type { ResolvedMusicResource } from '@server/usecases/ports'
import type { DownloadSourceType } from '@shared/types'
import { EncryptJWT, jwtDecrypt } from 'jose'

export interface LocalDownloadTicket {
  userId: string
  resourceRef: string
  sourceType: DownloadSourceType
  uri: string
  filename: string
  mediaType?: string
  music?: { resource: ResolvedMusicResource; tags: MusicFileTags }
}

export class InvalidLocalDownloadTicketError extends Error {
  constructor() {
    super('The local download source is invalid or expired.')
  }
}

export async function issueLocalDownloadTicket(secret: string, source: LocalDownloadTicket, now = new Date()) {
  const expiresAt = new Date(Math.floor(now.getTime() / 1000) * 1000 + 5 * 60_000)
  const id = await new EncryptJWT({ ...source })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ: 'zme-local-download+jwt' })
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .encrypt(await encryptionKey(secret))
  return { id: `local:${id}`, expiresAt: expiresAt.toISOString() }
}

export function isLocalDownloadId(id: string): boolean {
  return id.startsWith('local:')
}

export async function readLocalDownloadTicket(secret: string, id: string) {
  try {
    if (!isLocalDownloadId(id)) throw new InvalidLocalDownloadTicketError()
    const { payload, protectedHeader } = await jwtDecrypt(id.slice('local:'.length), await encryptionKey(secret))
    if (
      protectedHeader.typ !== 'zme-local-download+jwt' ||
      typeof payload.userId !== 'string' ||
      typeof payload.resourceRef !== 'string' ||
      !['http', 'magnet', 'torrent_url'].includes(String(payload.sourceType)) ||
      typeof payload.uri !== 'string' ||
      typeof payload.filename !== 'string' ||
      typeof payload.exp !== 'number'
    )
      throw new InvalidLocalDownloadTicketError()
    return {
      userId: payload.userId,
      resourceRef: payload.resourceRef,
      sourceType: payload.sourceType as DownloadSourceType,
      uri: payload.uri,
      filename: payload.filename,
      mediaType: typeof payload.mediaType === 'string' ? payload.mediaType : undefined,
      music: payload.music as LocalDownloadTicket['music'],
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    }
  } catch {
    throw new InvalidLocalDownloadTicketError()
  }
}

async function encryptionKey(secret: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`local-download:${secret}`)))
}
