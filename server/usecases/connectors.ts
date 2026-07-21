import { decryptConnectorPayload } from '@server/domain/connector-credentials'
import { chooseBestMatch } from '@server/domain/douban-match'
import type { Env } from '@server/env'
import type {
  ConnectorSummary,
  ConnectorSyncResult,
  DoubanConnectorInput,
  LibraryImportSyncResult,
  MediaSearchItem,
  MusicCollectionSummary,
  MusicPlaylistSyncResult,
} from '@shared/types'
import type { Deps } from './deps'
import { saveLibraryState, setWatchedState } from './library'
import { getActiveTmdbSource } from './media-sources'
import { evaluateMusicCollectionSubscription } from './media-subscriptions'
import type {
  ActiveMediaSource,
  ConnectorRecord,
  ImportedLibraryEntry,
  ImportedMusicTrack,
  MusicConnectorModule,
  MusicConnectorSession,
  MusicReleaseMetadata,
} from './ports'

const CONNECTOR_DEFINITIONS = {
  douban: { authModes: ['profile'], capabilities: ['library.import'] },
} as const
const MUSIC_AVAILABILITY_TTL_MS = 6 * 60 * 60 * 1000
const MUSIC_AVAILABILITY_CHECK_PAGE_SIZE = 500
const MUSIC_RELEASE_METADATA_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type ConnectorSyncTrigger = 'scheduled' | 'manual' | 'login'

export async function listConnectors(deps: Deps, userId: string): Promise<ConnectorSummary[]> {
  return (await deps.connectorsRepo.list(userId)).map((record) => toConnectorSummary(deps, record))
}

export async function saveDoubanConnector(
  deps: Deps,
  userId: string,
  input: DoubanConnectorInput,
): Promise<ConnectorSummary> {
  const profileId = normalizeDoubanProfileId(input.profileId)
  const record = await deps.connectorsRepo.save(userId, 'douban', {
    externalAccountId: profileId,
    displayName: profileId,
    avatarUrl: null,
    settings: {},
    credentialsEncrypted: null,
    status: 'connected',
    enabled: input.enabled,
  })
  return toConnectorSummary(deps, record)
}

export async function updateConnector(
  deps: Deps,
  userId: string,
  id: string,
  input: { enabled?: boolean },
): Promise<ConnectorSummary | null> {
  const record = await deps.connectorsRepo.updateState(userId, id, input)
  return record ? toConnectorSummary(deps, record) : null
}

export function deleteConnector(deps: Deps, userId: string, id: string): Promise<boolean> {
  return deps.connectorsRepo.delete(userId, id)
}

export async function syncConnector(
  deps: Deps,
  env: Env,
  userId: string,
  id: string,
  trigger: ConnectorSyncTrigger = 'scheduled',
): Promise<ConnectorSyncResult> {
  const connector = await deps.connectorsRepo.get(userId, id)
  if (!connector) throw new Error('Connector was not found.')
  try {
    const result =
      connector.kind === 'douban'
        ? await syncDoubanConnector(deps, connector)
        : await syncMusicConnector(deps, env, connector, trigger !== 'scheduled')
    await deps.connectorsRepo.markSynced(connector.id, result, null)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connector sync failed.'
    await deps.connectorsRepo.markSynced(connector.id, null, message)
    if (connector.kind !== 'douban' && /expired|session|login/i.test(message)) {
      await deps.connectorsRepo.updateState(userId, connector.id, { status: 'reauth_required' })
    }
    throw error
  }
}

export interface ConnectorSyncMessage {
  type: 'connector_sync'
  userId: string
  connectorId: string
}

export async function enqueueConnectorSync(deps: Deps, userId: string, connectorId: string): Promise<void> {
  const connector = await deps.connectorsRepo.get(userId, connectorId)
  if (!connector) throw new Error('Connector was not found.')
  await deps.connectorSyncQueue.enqueue({ userId, connectorId })
}

export async function syncEnabledConnectors(deps: Deps, env: Env): Promise<void> {
  const connectors = await deps.connectorsRepo.listEnabled()
  for (const connector of connectors) {
    try {
      await syncConnector(deps, env, connector.userId, connector.id, 'scheduled')
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'connector.sync.failed',
          connectorId: connector.id,
          kind: connector.kind,
          message: error instanceof Error ? error.message : 'Connector sync failed.',
        }),
      )
    }
  }
}

export function listConnectorPlaylists(
  deps: Deps,
  userId: string,
  connectorId: string,
): Promise<MusicCollectionSummary[]> {
  return deps.musicCollectionsRepo.listForConnector(userId, connectorId)
}

export async function saveConnectorPlaylistSelection(
  deps: Deps,
  userId: string,
  connectorId: string,
  selectedPlaylistIds: string[],
): Promise<{ selectedPlaylists: number }> {
  const connector = await deps.connectorsRepo.get(userId, connectorId)
  if (!connector || connector.kind === 'douban' || !deps.musicConnectors.has(connector.kind)) {
    throw new Error('Music connector was not found.')
  }
  const collections = await deps.musicCollectionsRepo.listForConnector(userId, connectorId)
  const knownIds = new Set(collections.map((item) => item.id))
  if (selectedPlaylistIds.some((id) => !knownIds.has(id))) throw new Error('Connector playlist was not found.')

  const uniqueIds = [...new Set(selectedPlaylistIds)]
  await deps.musicCollectionsRepo.setLibrarySelections(userId, connectorId, uniqueIds, new Date().toISOString())
  await deps.connectorSyncQueue.enqueue({ userId, connectorId })
  return { selectedPlaylists: uniqueIds.length }
}

async function syncDoubanConnector(deps: Deps, connector: ConnectorRecord): Promise<LibraryImportSyncResult> {
  const tmdb = await getActiveTmdbSource(deps)
  const entries = await deps.libraryImporters.douban.fetchEntries(connector.externalAccountId)
  return importLibraryEntries(deps, connector.userId, entries, tmdb)
}

async function syncMusicConnector(
  deps: Deps,
  env: Env,
  connector: ConnectorRecord,
  forceRefresh: boolean,
): Promise<MusicPlaylistSyncResult> {
  if (!connector.credentialsEncrypted) throw new Error(`${connector.kind} connector has no credentials.`)
  const module = getMusicConnector(deps, connector.kind)
  const session = module.open(
    await decryptConnectorPayload(env.CONNECTOR_CREDENTIALS_SECRET, connector.credentialsEncrypted),
  )
  const remotePlaylists = await session.listPlaylists()
  const existing = await deps.musicCollectionsRepo.listForConnector(connector.userId, connector.id)
  const selectedCollections: Array<{ id: string; externalId: string; tracks: ImportedMusicTrack[] }> = []
  for (const playlist of remotePlaylists) {
    const current = existing.find((item) => item.externalId === playlist.externalId)
    const collection = await deps.musicCollectionsRepo.upsert(connector.userId, {
      connectorId: connector.id,
      kind: 'playlist',
      provider: connector.kind,
      externalId: playlist.externalId,
      title: playlist.title,
      description: playlist.description,
      coverUrl: playlist.coverUrl,
      ownerName: playlist.ownerName,
      trackCount: playlist.trackCount,
      libraryAddedAt: current?.libraryAddedAt ?? null,
      remoteUpdatedAt: playlist.remoteUpdatedAt,
      lastSyncedAt: current?.lastSyncedAt ?? null,
    })
    if (!collection.libraryAddedAt) continue
    selectedCollections.push({ id: collection.id, externalId: playlist.externalId, tracks: [] })
  }

  for (const collection of selectedCollections) {
    collection.tracks = await session.listTracks(collection.externalId)
  }
  const hydratedTracks = await hydrateReleaseMetadata(
    deps,
    module,
    session,
    selectedCollections.flatMap((collection) => collection.tracks),
    forceRefresh,
  )
  let trackOffset = 0
  for (const collection of selectedCollections) {
    const playlistTracks = hydratedTracks.slice(trackOffset, trackOffset + collection.tracks.length)
    trackOffset += collection.tracks.length
    await deps.musicCollectionsRepo.replaceTracks(collection.id, playlistTracks)
    await deps.musicCollectionsRepo.updateSnapshot(connector.userId, collection.id, {
      trackCount: playlistTracks.length,
      lastSyncedAt: new Date().toISOString(),
    })
  }
  await deps.musicCollectionsRepo.deleteMissingConnectorCollections(
    connector.id,
    remotePlaylists.map((item) => item.externalId),
  )
  await refreshTrackAvailability(deps, connector, session, forceRefresh)
  for (const collection of selectedCollections) {
    await evaluateMusicCollectionSubscription(deps, connector.userId, collection.id)
  }
  return {
    capability: 'music.playlists.read',
    playlists: remotePlaylists.length,
    selectedPlaylists: selectedCollections.length,
    tracks: hydratedTracks.length,
  }
}

async function hydrateReleaseMetadata(
  deps: Deps,
  module: MusicConnectorModule,
  session: MusicConnectorSession,
  tracks: ImportedMusicTrack[],
  force: boolean,
): Promise<ImportedMusicTrack[]> {
  const releaseIds = [...new Set(tracks.flatMap((track) => (track.release ? [track.release.externalId] : [])))]
  if (releaseIds.length === 0) return tracks
  const staleBefore = force
    ? new Date().toISOString()
    : new Date(Date.now() - MUSIC_RELEASE_METADATA_TTL_MS).toISOString()
  const cached = await deps.musicCollectionsRepo.listReleaseMetadata(module.definition.kind, releaseIds, staleBefore)
  const metadata = new Map(cached.map((release) => [release.externalId, release]))
  const missingIds = releaseIds.filter((id) => !metadata.has(id))
  const updatedAt = new Date().toISOString()
  const imported = await session.getReleases(missingIds)
  for (const release of imported) {
    metadata.set(release.externalId, { provider: module.definition.kind, ...release, updatedAt })
  }

  const unresolvedIds = missingIds.filter((id) => !metadata.has(id))
  if (unresolvedIds.length > 0) {
    throw new Error(`${module.definition.kind} did not return release metadata for ${unresolvedIds.join(', ')}.`)
  }
  return tracks.map((track) => applyReleaseMetadata(track, metadata))
}

function applyReleaseMetadata(
  track: ImportedMusicTrack,
  metadata: Map<string, MusicReleaseMetadata>,
): ImportedMusicTrack {
  if (!track.release) return track
  const release = metadata.get(track.release.externalId)
  if (!release) return track
  return {
    ...track,
    release: {
      ...track.release,
      title: release.title,
      artists: release.artists,
      releaseDate: release.releaseDate,
      releaseType: release.releaseType,
      providerReleaseType: release.providerReleaseType,
      coverUrl: release.coverUrl,
      metadataUpdatedAt: release.updatedAt,
    },
    coverUrl: release.coverUrl ?? track.coverUrl,
  }
}

async function refreshTrackAvailability(
  deps: Deps,
  connector: ConnectorRecord,
  session: MusicConnectorSession,
  force: boolean,
): Promise<void> {
  const now = new Date()
  if (force) await deps.musicCollectionsRepo.clearTrackAvailabilities(connector.id)
  const staleBefore = new Date(now.getTime() - MUSIC_AVAILABILITY_TTL_MS).toISOString()
  let checkedTracks = 0

  while (true) {
    const candidates = await deps.musicCollectionsRepo.listTracksForAvailabilityCheck(
      connector.userId,
      connector.id,
      staleBefore,
      MUSIC_AVAILABILITY_CHECK_PAGE_SIZE,
    )
    if (candidates.length === 0) return

    const result = await session.checkTrackAvailability(candidates.map((track) => track.externalId))
    const checkedAt = new Date().toISOString()
    await deps.musicCollectionsRepo.setTrackAvailabilities(
      connector.userId,
      connector.id,
      candidates.map((track) => {
        const availability = result.results.get(track.externalId) ?? {
          status: 'unknown' as const,
          reason: result.interrupted?.reason ?? 'malformed_response',
          providerCode: result.interrupted?.providerCode ?? null,
          providerDetails: {},
        }
        return { trackId: track.id, ...availability, checkedAt }
      }),
    )
    checkedTracks += result.results.size
    if (result.interrupted) {
      console.warn(
        JSON.stringify({
          event: 'connector.music_availability.interrupted',
          connectorId: connector.id,
          checkedTracks,
          pendingTracks: candidates.length - result.results.size,
          reason: result.interrupted.reason,
          providerCode: result.interrupted.providerCode,
          message: result.interrupted.message,
        }),
      )
      return
    }
  }
}

async function importLibraryEntries(
  deps: Deps,
  userId: string,
  entries: ImportedLibraryEntry[],
  tmdb: ActiveMediaSource,
): Promise<LibraryImportSyncResult> {
  const result: LibraryImportSyncResult = {
    capability: 'library.import',
    scanned: entries.length,
    imported: 0,
    saved: 0,
    watched: 0,
    unmatched: 0,
  }
  for (const entry of entries) {
    const item = await matchImportedEntry(deps, entry, tmdb)
    if (!item) {
      result.unmatched += 1
      continue
    }
    if (entry.status === 'collect') {
      await setWatchedState(deps, userId, item, true, entry.markedAt ?? undefined)
      result.watched += 1
    } else {
      await saveLibraryState(deps, userId, item, entry.markedAt ?? undefined)
      result.saved += 1
    }
    result.imported += 1
  }
  return result
}

async function matchImportedEntry(
  deps: Deps,
  entry: ImportedLibraryEntry,
  tmdb: ActiveMediaSource,
): Promise<MediaSearchItem | null> {
  for (const query of [entry.title, ...entry.aliases].filter(Boolean)) {
    const match = chooseBestMatch(entry, query, await deps.mediaProvider.search(tmdb, query))
    if (match) return match
  }
  return null
}

export function toConnectorSummary(deps: Deps, record: ConnectorRecord): ConnectorSummary {
  const definition =
    record.kind === 'douban' ? CONNECTOR_DEFINITIONS.douban : getMusicConnector(deps, record.kind).definition
  return {
    id: record.id,
    kind: record.kind,
    displayName: record.displayName,
    avatarUrl: record.avatarUrl,
    externalAccountId: record.externalAccountId,
    authModes: [...definition.authModes],
    capabilities: [...definition.capabilities],
    status: record.status,
    enabled: record.enabled,
    lastSyncedAt: record.lastSyncedAt,
    lastError: record.lastError,
    lastResult: record.lastResult,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function getMusicConnector(deps: Deps, kind: string): MusicConnectorModule {
  const module = deps.musicConnectors.get(kind)
  if (!module) throw new Error(`Unsupported music connector: ${kind}.`)
  return module
}

function normalizeDoubanProfileId(value: string): string {
  const trimmed = value.trim()
  const match = trimmed.match(/douban\.com\/people\/([^/?#]+)/)
  return decodeURIComponent(match?.[1] ?? trimmed)
}
