export interface NeteaseArtist {
  name?: string
}

export interface NeteaseProfile {
  userId?: number
  nickname?: string
  avatarUrl?: string
}

export interface NeteasePlaylist {
  id?: number
  name?: string
  description?: string | null
  coverImgUrl?: string
  trackCount?: number
  updateTime?: number
  creator?: { nickname?: string }
}

export interface NeteaseSong {
  id?: number
  name?: string
  dt?: number
  no?: number
  cd?: string | number
  ar?: NeteaseArtist[]
  al?: { id?: number; name?: string; picUrl?: string }
}

export interface NeteaseAlbum {
  id?: number
  name?: string
  type?: string
  subType?: string
  publishTime?: number
  picUrl?: string
  artist?: NeteaseArtist
  artists?: NeteaseArtist[]
}

export interface NeteasePlaybackResource {
  id?: number
  url?: string | null
  type?: string | null
  size?: number | null
  level?: string | null
  code?: number
  freeTrialInfo?: unknown
  fee?: number
  payed?: number
  st?: number
  toast?: boolean
}

export interface NeteaseRiskData {
  verifyId?: string | number
  verifyType?: string | number
  verifyToken?: string
  params?: { event_id?: string; sign?: string } | string
}

export interface XeapiPublicKey {
  publicKey: string
  sk: string
  version: string
}
