import type { ImportedMusicPlaylist, ImportedMusicRelease, ImportedMusicTrack } from '@server/usecases/ports'
import { neteaseError, weapiRequest } from './client'
import { toPlaylist, toRelease, toTrack } from './mapper'
import type { NeteaseAlbum, NeteasePlaylist, NeteaseProfile, NeteaseSong } from './types'

const RELEASE_REQUEST_INTERVAL_MS = 250

export async function listPlaylists(credentials: string[]): Promise<ImportedMusicPlaylist[]> {
  const accountResponse = await weapiRequest<{ profile?: NeteaseProfile }>(
    '/weapi/w/nuser/account/get',
    {},
    credentials,
  )
  const userId = accountResponse.body.profile?.userId
  if (!userId) throw new Error('Netease session has expired.')

  const playlists: ImportedMusicPlaylist[] = []
  for (let offset = 0; ; offset += 100) {
    const response = await weapiRequest<{ playlist?: NeteasePlaylist[]; more?: boolean }>(
      '/weapi/user/playlist',
      { uid: userId, limit: 100, offset, includeVideo: true },
      credentials,
    )
    const page = (response.body.playlist ?? []).map(toPlaylist).filter((item) => item !== null)
    playlists.push(...page)
    if (!response.body.more || page.length === 0) break
  }
  return playlists
}

export async function listTracks(credentials: string[], playlistId: string): Promise<ImportedMusicTrack[]> {
  const detail = await weapiRequest<{ playlist?: { trackIds?: Array<{ id?: number }> } }>(
    '/weapi/v6/playlist/detail',
    { id: playlistId, n: 100_000, s: 8 },
    credentials,
  )
  const ids = (detail.body.playlist?.trackIds ?? []).flatMap((item) => (item.id ? [item.id] : []))
  const tracks: ImportedMusicTrack[] = []
  for (let offset = 0; offset < ids.length; offset += 500) {
    const pageIds = ids.slice(offset, offset + 500)
    const response = await weapiRequest<{ songs?: NeteaseSong[] }>(
      '/weapi/v3/song/detail',
      { c: JSON.stringify(pageIds.map((id) => ({ id }))) },
      credentials,
    )
    tracks.push(...(response.body.songs ?? []).map(toTrack).filter((item) => item !== null))
  }
  return tracks
}

export async function getReleases(credentials: string[], releaseIds: string[]): Promise<ImportedMusicRelease[]> {
  const uniqueReleaseIds = [...new Set(releaseIds)]
  if (uniqueReleaseIds.some((id) => !/^\d+$/.test(id))) throw new Error('Netease release id is invalid.')

  const releases: ImportedMusicRelease[] = []
  for (const [index, releaseId] of uniqueReleaseIds.entries()) {
    const response = await weapiRequest<{ code?: number; message?: string; album?: NeteaseAlbum }>(
      `/weapi/v1/album/${releaseId}`,
      {},
      credentials,
    )
    if (response.body.code !== 200) {
      throw new Error(neteaseError(`Netease failed to load release ${releaseId}`, response.body))
    }
    const release = toRelease(response.body.album)
    if (!release || release.externalId !== releaseId) {
      throw new Error(`Netease release ${releaseId} response is incomplete.`)
    }
    releases.push(release)
    if (index < uniqueReleaseIds.length - 1) await delay(RELEASE_REQUEST_INTERVAL_MS)
  }
  return releases
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
