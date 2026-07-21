import type { MusicConnectorDefinition } from '@server/usecases/ports'

export const neteaseConnectorDefinition = {
  kind: 'netease',
  authModes: ['qr', 'sms'],
  capabilities: ['music.playlists.read', 'music.tracks.download'],
  dispatchIntervalSeconds: 10,
} as const satisfies MusicConnectorDefinition
