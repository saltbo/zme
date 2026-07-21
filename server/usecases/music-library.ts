import type {
  MusicAlbumDetails,
  MusicCollectionDetails,
  MusicCollectionSummary,
  MusicFavoriteTrackInput,
} from '@shared/types'
import type { Deps } from './deps'
import { getMusicCollectionWithSubscription } from './media-subscriptions'
import type { MusicTrackInput } from './ports'

export function listMusicCollections(
  deps: Deps,
  userId: string,
  kind: 'playlist' | 'album',
): Promise<MusicCollectionSummary[]> {
  return deps.musicCollectionsRepo.listLibrary(userId, kind)
}

export function getMusicCollection(deps: Deps, userId: string, id: string): Promise<MusicCollectionDetails | null> {
  return getMusicCollectionWithSubscription(deps, userId, id)
}

export async function removeMusicCollection(deps: Deps, userId: string, id: string): Promise<boolean> {
  const collection = await deps.musicCollectionsRepo.getDetails(userId, id)
  if (!collection) return false
  const subscription = await deps.mediaSubscriptionsRepo.find(userId, 'music_collection', id)
  if (subscription?.enabled) {
    const now = new Date().toISOString()
    await deps.mediaSubscriptionsRepo.disable(userId, subscription.id, now)
    await deps.downloadRecordsRepo.cancelUnwantedForSubscription(subscription.id, now)
  }
  if (collection.provider === 'netease') {
    await deps.musicCollectionsRepo.setLibraryAdded(userId, id, null)
    await deps.musicCollectionsRepo.replaceTracks(id, [])
    return true
  }
  return deps.musicCollectionsRepo.delete(userId, id)
}

export async function getFavoriteSongs(deps: Deps, userId: string): Promise<MusicCollectionDetails | null> {
  const collection = await deps.musicCollectionsRepo.find(userId, 'zme', 'favorite-songs')
  return collection ? getMusicCollectionWithSubscription(deps, userId, collection.id) : null
}

export async function setFavoriteSong(
  deps: Deps,
  userId: string,
  track: MusicFavoriteTrackInput,
  selected: boolean,
): Promise<MusicCollectionDetails | null> {
  const existing = await deps.musicCollectionsRepo.find(userId, 'zme', 'favorite-songs')
  if (!existing && !selected) return null
  const now = new Date().toISOString()
  const collection =
    existing ??
    (await deps.musicCollectionsRepo.upsert(userId, {
      connectorId: null,
      kind: 'favorites',
      provider: 'zme',
      externalId: 'favorite-songs',
      title: 'Favorite Songs',
      description: null,
      coverUrl: null,
      ownerName: null,
      trackCount: 0,
      libraryAddedAt: now,
      remoteUpdatedAt: null,
      lastSyncedAt: now,
    }))
  const details = await deps.musicCollectionsRepo.getDetails(userId, collection.id)
  const tracks = (details?.tracks ?? []).map(toTrackInput)
  const currentIndex = tracks.findIndex((item) => item.mediaKey === track.mediaKey)
  if (selected && currentIndex === -1) tracks.push({ ...track, addedAt: now })
  if (!selected && currentIndex !== -1) tracks.splice(currentIndex, 1)
  await deps.musicCollectionsRepo.replaceTracks(collection.id, tracks)
  await deps.musicCollectionsRepo.updateSnapshot(userId, collection.id, {
    trackCount: tracks.length,
    lastSyncedAt: now,
  })
  return getMusicCollectionWithSubscription(deps, userId, collection.id)
}

export async function saveMusicAlbum(deps: Deps, userId: string, mediaKey: string): Promise<MusicCollectionDetails> {
  const album = await deps.musicProvider.details(mediaKey)
  const now = new Date().toISOString()
  const collection = await deps.musicCollectionsRepo.upsert(userId, {
    connectorId: null,
    kind: 'album',
    provider: 'musicbrainz',
    externalId: mediaKey,
    title: album.title,
    description: album.disambiguation,
    coverUrl: album.coverArt.frontUrl ?? album.coverArt.frontThumbnailUrl,
    ownerName: album.artist,
    trackCount: album.media.reduce((total, medium) => total + medium.tracks.length, 0),
    libraryAddedAt: now,
    remoteUpdatedAt: null,
    lastSyncedAt: now,
  })
  await deps.musicCollectionsRepo.replaceTracks(collection.id, albumTracks(album, now))
  const details = await getMusicCollectionWithSubscription(deps, userId, collection.id)
  if (!details) throw new Error('Music album disappeared after it was saved.')
  return details
}

function albumTracks(album: MusicAlbumDetails, addedAt: string): MusicTrackInput[] {
  return album.media.flatMap((medium) =>
    medium.tracks.map((track) => {
      const externalId = track.recordingMbid ?? `${album.releaseGroupMbid}:${medium.position}:${track.position}`
      return {
        provider: 'musicbrainz' as const,
        externalId,
        mediaKey: track.recordingMediaKey ?? `musicbrainz:recording:${externalId}`,
        title: track.title,
        artists: album.artist ? [album.artist] : [],
        albumTitle: album.title,
        albumExternalId: album.releaseGroupMbid,
        coverUrl: album.coverArt.frontThumbnailUrl ?? album.coverArt.frontUrl,
        durationMs: track.lengthMs,
        isrcs: track.isrcs,
        addedAt,
      }
    }),
  )
}

function toTrackInput(track: MusicCollectionDetails['tracks'][number]): MusicTrackInput {
  return {
    provider: track.provider,
    externalId: track.externalId,
    mediaKey: track.mediaKey,
    title: track.title,
    artists: track.artists,
    albumTitle: track.albumTitle,
    albumExternalId: track.albumExternalId,
    coverUrl: track.coverUrl,
    durationMs: track.durationMs,
    isrcs: track.isrcs,
    addedAt: track.addedAt,
  }
}
