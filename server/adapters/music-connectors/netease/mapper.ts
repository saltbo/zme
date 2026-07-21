import type { ImportedMusicPlaylist, ImportedMusicRelease, ImportedMusicTrack } from '@server/usecases/ports'
import type { NeteaseAlbum, NeteasePlaylist, NeteaseSong } from './types'

export function toPlaylist(value: NeteasePlaylist): ImportedMusicPlaylist | null {
  if (!value.id || !value.name) return null
  return {
    externalId: String(value.id),
    title: value.name,
    description: value.description ?? null,
    coverUrl: value.coverImgUrl ?? null,
    ownerName: value.creator?.nickname ?? null,
    trackCount: value.trackCount ?? 0,
    remoteUpdatedAt: value.updateTime ? new Date(value.updateTime).toISOString() : null,
  }
}

export function toTrack(value: NeteaseSong): ImportedMusicTrack | null {
  if (!value.id || !value.name) return null
  return {
    provider: 'netease',
    externalId: String(value.id),
    mediaKey: `netease:track:${value.id}`,
    title: value.name,
    artists: (value.ar ?? []).flatMap((artist) => (artist.name ? [artist.name] : [])),
    release: value.al?.id
      ? {
          provider: 'netease',
          externalId: String(value.al.id),
          title: value.al.name ?? '',
          artists: [],
          releaseDate: null,
          releaseType: 'unknown',
          providerReleaseType: null,
          coverUrl: value.al.picUrl ?? null,
          metadataUpdatedAt: null,
          discNumber: positiveInteger(value.cd),
          trackNumber: positiveInteger(value.no),
        }
      : null,
    coverUrl: value.al?.picUrl ?? null,
    durationMs: value.dt ?? null,
    isrcs: [],
  }
}

export function toRelease(value: NeteaseAlbum | undefined): ImportedMusicRelease | null {
  if (!value?.id || !value.name) return null
  const artists = (value.artists ?? []).flatMap((artist) => (artist.name ? [artist.name] : []))
  if (artists.length === 0 && value.artist?.name) artists.push(value.artist.name)
  return {
    externalId: String(value.id),
    title: value.name,
    artists,
    releaseDate: timestampDate(value.publishTime),
    releaseType: normalizeReleaseType(value.type ?? value.subType),
    providerReleaseType: value.type?.trim() || value.subType?.trim() || null,
    coverUrl: value.picUrl ?? null,
  }
}

function normalizeReleaseType(value: string | undefined): ImportedMusicRelease['releaseType'] {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return 'unknown'
  if (normalized === 'album' || normalized === '专辑') return 'album'
  if (normalized === 'single' || normalized === '单曲') return 'single'
  if (normalized === 'ep') return 'ep'
  if (normalized === 'compilation' || normalized === '精选集') return 'compilation'
  if (normalized === 'soundtrack' || normalized === '原声') return 'soundtrack'
  if (normalized === 'live' || normalized === '现场') return 'live'
  if (normalized === 'broadcast' || normalized === '广播') return 'broadcast'
  return 'other'
}

function timestampDate(value: number | undefined): string | null {
  if (!value || !Number.isFinite(value)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

function positiveInteger(value: string | number | undefined): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : null
  const match = value?.match(/\d+/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}
