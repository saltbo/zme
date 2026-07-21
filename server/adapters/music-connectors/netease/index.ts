import type { MusicConnectorModule, MusicConnectorSession } from '@server/usecases/ports'
import { neteaseAuth } from './auth'
import { neteaseConnectorDefinition } from './definition'
import { getReleases, listPlaylists, listTracks } from './library'
import { checkTrackAvailability, resolveResource } from './resource'

export { encryptEapi, encryptXeapi } from './crypto'

export const neteaseMusicConnector: MusicConnectorModule = {
  definition: neteaseConnectorDefinition,
  auth: neteaseAuth,
  open(credentials): MusicConnectorSession {
    const cookies = parseCredentials(credentials)
    return {
      listPlaylists: () => listPlaylists(cookies),
      listTracks: (playlistId) => listTracks(cookies, playlistId),
      getReleases: (releaseIds) => getReleases(cookies, releaseIds),
      checkTrackAvailability: (trackIds) => checkTrackAvailability(cookies, trackIds),
      resolve: (input) => resolveResource(cookies, input),
    }
  },
}

function parseCredentials(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('Netease connector credentials are invalid.')
  }
  return value
}
