import {
  decryptConnectorCredentials,
  encryptConnectorCredentials,
  validateConnectorCredentialsSecret,
} from '@server/domain/connector-credentials'
import { chooseBestMatch } from '@server/domain/douban-match'
import type { Env } from '@server/env'
import type {
  ConnectorLoginAttempt,
  ConnectorSummary,
  ConnectorSyncResult,
  DoubanConnectorInput,
  LibraryImportSyncResult,
  MediaSearchItem,
  MusicCollectionSummary,
  MusicPlaylistSyncResult,
  NeteaseSmsCodeInput,
  NeteaseSmsLoginInput,
} from '@shared/types'
import type { Deps } from './deps'
import { saveLibraryState, setWatchedState } from './library'
import { getActiveTmdbSource } from './media-sources'
import { evaluateMusicCollectionSubscription } from './media-subscriptions'
import type {
  ActiveMediaSource,
  ConnectedMusicAccount,
  ConnectorLoginAttemptRecord,
  ConnectorRecord,
  ImportedLibraryEntry,
  MusicQrLoginResult,
} from './ports'

const CONNECTOR_DEFINITIONS = {
  douban: { authModes: ['profile'], capabilities: ['library.import'] },
  netease: { authModes: ['qr', 'sms'], capabilities: ['music.playlists.read', 'music.tracks.download'] },
} as const
const MUSIC_AVAILABILITY_TTL_MS = 6 * 60 * 60 * 1000
const MUSIC_AVAILABILITY_CHECK_PAGE_SIZE = 500

export type ConnectorSyncTrigger = 'scheduled' | 'manual' | 'login'

export async function listConnectors(deps: Deps, userId: string): Promise<ConnectorSummary[]> {
  return (await deps.connectorsRepo.list(userId)).map(toSummary)
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
  return toSummary(record)
}

export async function updateConnector(
  deps: Deps,
  userId: string,
  id: string,
  input: { enabled?: boolean },
): Promise<ConnectorSummary | null> {
  const record = await deps.connectorsRepo.updateState(userId, id, input)
  return record ? toSummary(record) : null
}

export function deleteConnector(deps: Deps, userId: string, id: string): Promise<boolean> {
  return deps.connectorsRepo.delete(userId, id)
}

export async function beginNeteaseLogin(deps: Deps, env: Env, userId: string): Promise<ConnectorLoginAttempt> {
  validateConnectorCredentialsSecret(env.CONNECTOR_CREDENTIALS_SECRET)
  const login = await deps.musicPlaylistConnectors.netease.beginQrLogin()
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  await deps.connectorLoginAttemptsRepo.create({
    id,
    userId,
    kind: 'netease',
    externalKey: login.key,
    credentialsEncrypted: await encryptConnectorCredentials(env.CONNECTOR_CREDENTIALS_SECRET, login.cookies),
    status: 'waiting_scan',
    expiresAt: login.expiresAt,
    createdAt: now,
    updatedAt: now,
  })
  return { id, kind: 'netease', qrUrl: login.qrUrl, status: 'waiting_scan', expiresAt: login.expiresAt }
}

export async function checkNeteaseLogin(
  deps: Deps,
  env: Env,
  userId: string,
  attemptId: string,
): Promise<{ attempt: ConnectorLoginAttempt; connector: ConnectorSummary | null }> {
  const attempt = await deps.connectorLoginAttemptsRepo.get(userId, attemptId)
  if (!attempt) throw new Error('Connector login attempt was not found.')
  if (Date.parse(attempt.expiresAt) <= Date.now()) {
    await deps.connectorLoginAttemptsRepo.update(userId, attempt.id, {
      status: 'expired',
      updatedAt: new Date().toISOString(),
    })
    return { attempt: toLoginAttempt(attempt, 'expired'), connector: null }
  }
  if (!attempt.credentialsEncrypted) throw new Error('Connector login attempt has no credentials.')

  const credentials = await decryptConnectorCredentials(env.CONNECTOR_CREDENTIALS_SECRET, attempt.credentialsEncrypted)
  const riskVerification = parseRiskVerification(attempt.externalKey)
  if (riskVerification) {
    const result = await deps.musicPlaylistConnectors.netease.checkRiskVerification(
      riskVerification.qrCode,
      credentials,
    )
    if (result.status === 'connected' && riskVerification.loginKey) {
      const resumed = await deps.musicPlaylistConnectors.netease.checkQrLogin(riskVerification.loginKey, result.cookies)
      return saveQrLoginResult(deps, env, userId, attempt, riskVerification.loginKey, resumed)
    }
    await deps.connectorLoginAttemptsRepo.update(userId, attempt.id, {
      status: result.status,
      credentialsEncrypted: await encryptConnectorCredentials(env.CONNECTOR_CREDENTIALS_SECRET, result.cookies),
      updatedAt: new Date().toISOString(),
    })
    return { attempt: toLoginAttempt(attempt, result.status), connector: null }
  }

  const result = await deps.musicPlaylistConnectors.netease.checkQrLogin(attempt.externalKey, credentials)
  return saveQrLoginResult(deps, env, userId, attempt, attempt.externalKey, result)
}

async function saveQrLoginResult(
  deps: Deps,
  env: Env,
  userId: string,
  attempt: ConnectorLoginAttemptRecord,
  loginKey: string,
  result: MusicQrLoginResult,
): Promise<{ attempt: ConnectorLoginAttempt; connector: ConnectorSummary | null }> {
  const encrypted = await encryptConnectorCredentials(env.CONNECTOR_CREDENTIALS_SECRET, result.cookies)
  if (result.status === 'verification_required') {
    const externalKey = encodeRiskVerification(result.verification, loginKey)
    await deps.connectorLoginAttemptsRepo.update(userId, attempt.id, {
      externalKey,
      status: 'waiting_scan',
      expiresAt: result.verification.expiresAt,
      credentialsEncrypted: encrypted,
      updatedAt: new Date().toISOString(),
    })
    return {
      attempt: toLoginAttempt({ ...attempt, externalKey, expiresAt: result.verification.expiresAt }, 'waiting_scan'),
      connector: null,
    }
  }

  await deps.connectorLoginAttemptsRepo.update(userId, attempt.id, {
    externalKey: loginKey,
    status: result.status,
    credentialsEncrypted: encrypted,
    updatedAt: new Date().toISOString(),
  })

  if (result.status !== 'connected') {
    return { attempt: toLoginAttempt(attempt, result.status), connector: null }
  }

  const connector = await saveConnectedNeteaseConnector(deps, env, userId, result.account, encrypted)
  return { attempt: toLoginAttempt(attempt, 'connected'), connector }
}

export function sendNeteaseSmsCode(deps: Deps, input: NeteaseSmsCodeInput): Promise<void> {
  return deps.musicPlaylistConnectors.netease.sendSmsCode(input)
}

export async function loginNeteaseWithSms(
  deps: Deps,
  env: Env,
  userId: string,
  input: NeteaseSmsLoginInput,
): Promise<{ connector: ConnectorSummary | null; verification: ConnectorLoginAttempt | null }> {
  validateConnectorCredentialsSecret(env.CONNECTOR_CREDENTIALS_SECRET)
  let credentials: string[] = []
  if (input.verificationAttemptId) {
    const attempt = await deps.connectorLoginAttemptsRepo.get(userId, input.verificationAttemptId)
    if (!attempt || !parseRiskVerification(attempt.externalKey)) {
      throw new Error('Netease account verification attempt was not found.')
    }
    if (attempt.status !== 'connected' || Date.parse(attempt.expiresAt) <= Date.now()) {
      throw new Error('Netease account verification is not complete.')
    }
    if (!attempt.credentialsEncrypted) throw new Error('Netease account verification has no credentials.')
    credentials = await decryptConnectorCredentials(env.CONNECTOR_CREDENTIALS_SECRET, attempt.credentialsEncrypted)
  }

  const result = await deps.musicPlaylistConnectors.netease.loginWithSms(input, credentials)
  const encrypted = await encryptConnectorCredentials(env.CONNECTOR_CREDENTIALS_SECRET, result.cookies)
  if (result.status === 'verification_required') {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    await deps.connectorLoginAttemptsRepo.create({
      id,
      userId,
      kind: 'netease',
      externalKey: encodeRiskVerification(result.verification),
      credentialsEncrypted: encrypted,
      status: 'waiting_scan',
      expiresAt: result.verification.expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    return {
      connector: null,
      verification: {
        id,
        kind: 'netease',
        qrUrl: result.verification.qrUrl,
        status: 'waiting_scan',
        expiresAt: result.verification.expiresAt,
      },
    }
  }

  const connector = await saveConnectedNeteaseConnector(deps, env, userId, result.account, encrypted)
  return { connector, verification: null }
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
        : await syncNeteaseConnector(deps, env, connector, trigger !== 'scheduled')
    await deps.connectorsRepo.markSynced(connector.id, result, null)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connector sync failed.'
    await deps.connectorsRepo.markSynced(connector.id, null, message)
    if (connector.kind === 'netease' && /expired|session|login/i.test(message)) {
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
  if (connector?.kind !== 'netease') throw new Error('Netease connector was not found.')
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

async function syncNeteaseConnector(
  deps: Deps,
  env: Env,
  connector: ConnectorRecord,
  forceAvailability: boolean,
): Promise<MusicPlaylistSyncResult> {
  if (!connector.credentialsEncrypted) throw new Error('Netease connector has no credentials.')
  const credentials = await decryptConnectorCredentials(
    env.CONNECTOR_CREDENTIALS_SECRET,
    connector.credentialsEncrypted,
  )
  const remotePlaylists = await deps.musicPlaylistConnectors.netease.listPlaylists(credentials)
  const existing = await deps.musicCollectionsRepo.listForConnector(connector.userId, connector.id)
  const selectedCollectionIds: string[] = []
  let selectedPlaylists = 0
  let tracks = 0
  for (const playlist of remotePlaylists) {
    const current = existing.find((item) => item.externalId === playlist.externalId)
    const collection = await deps.musicCollectionsRepo.upsert(connector.userId, {
      connectorId: connector.id,
      kind: 'playlist',
      provider: 'netease',
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
    const playlistTracks = await deps.musicPlaylistConnectors.netease.listTracks(credentials, playlist.externalId)
    await deps.musicCollectionsRepo.replaceTracks(collection.id, playlistTracks)
    await deps.musicCollectionsRepo.updateSnapshot(connector.userId, collection.id, {
      trackCount: playlistTracks.length,
      lastSyncedAt: new Date().toISOString(),
    })
    selectedCollectionIds.push(collection.id)
    selectedPlaylists += 1
    tracks += playlistTracks.length
  }
  await deps.musicCollectionsRepo.deleteMissingConnectorCollections(
    connector.id,
    remotePlaylists.map((item) => item.externalId),
  )
  await refreshNeteaseTrackAvailability(deps, connector, credentials, forceAvailability)
  for (const collectionId of selectedCollectionIds) {
    await evaluateMusicCollectionSubscription(deps, connector.userId, collectionId)
  }
  return {
    capability: 'music.playlists.read',
    playlists: remotePlaylists.length,
    selectedPlaylists,
    tracks,
  }
}

async function refreshNeteaseTrackAvailability(
  deps: Deps,
  connector: ConnectorRecord,
  credentials: string[],
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

    const result = await deps.musicPlaylistConnectors.netease.checkTrackAvailability(
      credentials,
      candidates.map((track) => track.externalId),
    )
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

async function saveConnectedNeteaseConnector(
  deps: Deps,
  env: Env,
  userId: string,
  account: ConnectedMusicAccount,
  credentialsEncrypted: string,
): Promise<ConnectorSummary> {
  const record = await deps.connectorsRepo.save(userId, 'netease', {
    externalAccountId: account.externalAccountId,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    settings: {},
    credentialsEncrypted,
    status: 'connected',
    enabled: true,
  })
  await syncConnector(deps, env, userId, record.id, 'login')
  const synced = await deps.connectorsRepo.get(userId, record.id)
  return synced ? toSummary(synced) : toSummary(record)
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

function toSummary(record: ConnectorRecord): ConnectorSummary {
  const definition = CONNECTOR_DEFINITIONS[record.kind]
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

function toLoginAttempt(
  record: { id: string; kind: 'netease'; externalKey: string; expiresAt: string },
  status: ConnectorLoginAttempt['status'],
): ConnectorLoginAttempt {
  const riskVerification = parseRiskVerification(record.externalKey)
  return {
    id: record.id,
    kind: record.kind,
    qrUrl: riskVerification?.qrUrl ?? `https://music.163.com/login?codekey=${encodeURIComponent(record.externalKey)}`,
    status,
    expiresAt: record.expiresAt,
  }
}

function encodeRiskVerification(value: { qrCode: string; qrUrl: string }, loginKey?: string): string {
  return `risk:${JSON.stringify(loginKey ? { ...value, loginKey } : value)}`
}

function parseRiskVerification(value: string): { qrCode: string; qrUrl: string; loginKey?: string } | null {
  if (!value.startsWith('risk:')) return null
  const parsed = JSON.parse(value.slice('risk:'.length)) as {
    qrCode?: unknown
    qrUrl?: unknown
    loginKey?: unknown
  }
  if (typeof parsed.qrCode !== 'string' || typeof parsed.qrUrl !== 'string') {
    throw new Error('Netease account verification data is invalid.')
  }
  if (parsed.loginKey !== undefined && typeof parsed.loginKey !== 'string') {
    throw new Error('Netease account verification login key is invalid.')
  }
  return { qrCode: parsed.qrCode, qrUrl: parsed.qrUrl, loginKey: parsed.loginKey }
}

function normalizeDoubanProfileId(value: string): string {
  const trimmed = value.trim()
  const match = trimmed.match(/douban\.com\/people\/([^/?#]+)/)
  return decodeURIComponent(match?.[1] ?? trimmed)
}
