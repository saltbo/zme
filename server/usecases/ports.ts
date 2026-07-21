import type {
  BookDetails,
  BookDiscoveryInput,
  BookSearchItem,
  ConnectorKind,
  ConnectorStatus,
  ConnectorSyncResult,
  CreateDownloadInput,
  DownloaderInput,
  DownloaderKind,
  DownloadRecordStatus,
  DownloadTaskPage,
  DownloadTaskStatus,
  DownloadTaskSummary,
  IndexerInput,
  IndexerKind,
  IndexerSearchItem,
  LibraryFilterKind,
  LibraryFilterStatus,
  LibraryKind,
  MediaDetails,
  MediaDiscoverInput,
  MediaDiscoverPage,
  MediaGenre,
  MediaKind,
  MediaPersonCredits,
  MediaSearchItem,
  MediaSeasonDetails,
  MediaSourceInput,
  MediaSourceKind,
  MusicAlbumDetails,
  MusicAlbumSearchItem,
  MusicAvailabilityReason,
  MusicCollectionDetails,
  MusicCollectionKind,
  MusicCollectionProvider,
  MusicCollectionSummary,
  MusicDiscoveryInput,
  MusicDownloadQuality,
  MusicDownloadStatus,
  MusicLibraryTrack,
  MusicSearchItem,
  NeteaseSmsCodeInput,
  NeteaseSmsLoginInput,
  ResourcePage,
} from '@shared/types'

/** Parsed connection settings for an external service configured by the user. */
export interface ConnectorConfig {
  endpoint: string
  credentials: Record<string, string>
  options: Record<string, string>
}

export interface DownloaderGateway {
  readonly supportedSourceTypes: ReadonlyArray<CreateDownloadInput['sourceType']>
  /** Submits a download to the remote downloader. Throws on rejection. */
  submit(config: ConnectorConfig, input: CreateDownloadInput): Promise<{ externalTaskId: string | null }>
  /** Throws when the downloader is unreachable or misconfigured. */
  probe(config: ConnectorConfig): Promise<void>
}

export interface DownloadTaskOwner {
  downloaderId: string
  downloaderName: string
  downloaderKind: DownloaderKind
}

export interface ListDownloadTasksInput {
  status?: DownloadTaskStatus
  page: number
  pageSize: number
}

export type DownloadTaskEvent =
  | { event: 'snapshot'; data: { items: DownloadTaskSummary[] } }
  | { event: 'heartbeat'; data: { at: string } }
  | { event: 'stream-error'; data: { message: string } }
  | {
      event: 'upstream-error'
      data: {
        downloaderId: string
        downloaderName: string
        message: string
        retryingInMs?: number
      }
    }

export type DownloadTaskGatewayEvent =
  | { event: 'snapshot'; data: { items: DownloadTaskSummary[] } }
  | { event: 'error'; data: { message: string } }

export interface DownloadTaskGateway {
  list(config: ConnectorConfig, owner: DownloadTaskOwner, input: ListDownloadTasksInput): Promise<DownloadTaskPage>
  stream(
    config: ConnectorConfig,
    owner: DownloadTaskOwner,
    signal: AbortSignal,
    emit: (event: DownloadTaskGatewayEvent) => void | Promise<void>,
  ): Promise<void>
}

export interface IndexerSearchInput {
  query: string
  searchType?: 'search' | 'audiosearch' | 'booksearch'
  categories?: number[]
  title?: string
  year?: string
  aliases?: string[]
  kind?: 'movie' | 'tv'
  imdbId?: string
  tmdbId?: number
  tvdbId?: number
}

export type ResolvedDownloadSource = Pick<CreateDownloadInput, 'uri' | 'sourceType'>

export interface IndexerGateway {
  search(config: ConnectorConfig, input: IndexerSearchInput): Promise<IndexerSearchItem[]>
  /** Throws when the indexer is unreachable or misconfigured. */
  probe(config: ConnectorConfig): Promise<void>
  /** Whether the given download URL is served through this indexer instance. */
  matchesDownloadUrl(config: ConnectorConfig, uri: string): boolean
  /** Resolves an indexer proxy download URL to a direct source, null when unresolvable. */
  resolveDownloadSource(config: ConnectorConfig, uri: string): Promise<ResolvedDownloadSource | null>
}

export class IndexerNotConfiguredError extends Error {
  constructor() {
    super('No enabled indexers are configured.')
    this.name = 'IndexerNotConfiguredError'
  }
}

export type ConnectorHealthStatus = 'unknown' | 'online' | 'offline'

export interface ConnectorHealthPatch {
  status: 'online' | 'offline'
  message: string
  checkedAt: string
}

export interface DownloaderRecord {
  id: string
  description: string | null
  kind: DownloaderKind
  config: ConnectorConfig
  enabled: boolean
  healthStatus: ConnectorHealthStatus
  healthMessage: string | null
  healthCheckedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface DownloadersRepo {
  list(userId: string): Promise<DownloaderRecord[]>
  get(userId: string, id: string): Promise<DownloaderRecord | null>
  getEnabled(userId: string, id: string): Promise<DownloaderRecord | null>
  listEnabled(userId: string): Promise<DownloaderRecord[]>
  create(userId: string, input: DownloaderInput): Promise<DownloaderRecord>
  update(userId: string, id: string, input: DownloaderInput): Promise<DownloaderRecord | null>
  delete(userId: string, id: string): Promise<boolean>
  setHealth(userId: string, id: string, health: ConnectorHealthPatch): Promise<DownloaderRecord | null>
}

export interface IndexerRecord {
  id: string
  description: string | null
  kind: IndexerKind
  config: ConnectorConfig
  enabled: boolean
  healthStatus: ConnectorHealthStatus
  healthMessage: string | null
  healthCheckedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface IndexersRepo {
  list(): Promise<IndexerRecord[]>
  get(id: string): Promise<IndexerRecord | null>
  listEnabled(): Promise<IndexerRecord[]>
  create(input: IndexerInput): Promise<IndexerRecord>
  update(id: string, input: IndexerInput): Promise<IndexerRecord | null>
  delete(id: string): Promise<boolean>
  setHealth(id: string, health: ConnectorHealthPatch): Promise<IndexerRecord | null>
}

export interface MediaSourceRecord {
  id: string
  description: string | null
  kind: MediaSourceKind
  credentials: Record<string, string>
  options: Record<string, string>
  enabled: boolean
  healthStatus: ConnectorHealthStatus
  healthMessage: string | null
  healthCheckedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface MediaSourcesRepo {
  list(): Promise<MediaSourceRecord[]>
  get(id: string): Promise<MediaSourceRecord | null>
  findEnabled(kind: MediaSourceKind): Promise<MediaSourceRecord | null>
  create(input: MediaSourceInput): Promise<MediaSourceRecord>
  update(id: string, input: MediaSourceInput): Promise<MediaSourceRecord | null>
  delete(id: string): Promise<boolean>
  setHealth(id: string, health: ConnectorHealthPatch): Promise<MediaSourceRecord | null>
}

export interface LibraryRecord {
  id: string
  userId: string | null
  mediaKey: string
  kind: LibraryKind
  tmdbId: number | null
  savedAt: string | null
  watchedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface LibraryStatePatch {
  savedAt: string | null
  watchedAt: string | null
  updatedAt: string
}

export interface LibraryRepo {
  get(userId: string, mediaKey: string): Promise<LibraryRecord | null>
  listAll(userId: string): Promise<LibraryRecord[]>
  listPage(
    userId: string,
    filter: { kind?: LibraryFilterKind; status?: LibraryFilterStatus },
    page: number,
    pageSize: number,
  ): Promise<{ rows: LibraryRecord[]; total: number }>
  insert(record: LibraryRecord): Promise<void>
  setStates(userId: string, mediaKey: string, patch: LibraryStatePatch): Promise<LibraryRecord | null>
  delete(userId: string, mediaKey: string): Promise<boolean>
}

export interface ConnectorRecord {
  id: string
  userId: string
  kind: ConnectorKind
  externalAccountId: string
  displayName: string
  avatarUrl: string | null
  settings: Record<string, string>
  credentialsEncrypted: string | null
  status: ConnectorStatus
  enabled: boolean
  lastSyncedAt: string | null
  lastError: string | null
  lastResult: ConnectorSyncResult | null
  createdAt: string
  updatedAt: string
}

export interface ConnectorsRepo {
  list(userId: string): Promise<ConnectorRecord[]>
  get(userId: string, id: string): Promise<ConnectorRecord | null>
  findByKind(userId: string, kind: ConnectorKind): Promise<ConnectorRecord | null>
  listEnabled(): Promise<ConnectorRecord[]>
  save(
    userId: string,
    kind: ConnectorKind,
    input: Omit<
      ConnectorRecord,
      'id' | 'userId' | 'kind' | 'lastSyncedAt' | 'lastError' | 'lastResult' | 'createdAt' | 'updatedAt'
    >,
  ): Promise<ConnectorRecord>
  updateState(
    userId: string,
    id: string,
    input: { enabled?: boolean; status?: ConnectorStatus },
  ): Promise<ConnectorRecord | null>
  delete(userId: string, id: string): Promise<boolean>
  markSynced(id: string, result: ConnectorSyncResult | null, error: string | null): Promise<void>
}

export interface ConnectorLoginAttemptRecord {
  id: string
  userId: string
  kind: 'netease'
  externalKey: string
  credentialsEncrypted: string | null
  status: 'waiting_scan' | 'waiting_confirmation' | 'connected' | 'expired'
  expiresAt: string
  createdAt: string
  updatedAt: string
}

export interface ConnectorLoginAttemptsRepo {
  create(record: ConnectorLoginAttemptRecord): Promise<void>
  get(userId: string, id: string): Promise<ConnectorLoginAttemptRecord | null>
  update(
    userId: string,
    id: string,
    patch: Partial<
      Pick<ConnectorLoginAttemptRecord, 'credentialsEncrypted' | 'externalKey' | 'status' | 'expiresAt' | 'updatedAt'>
    >,
  ): Promise<ConnectorLoginAttemptRecord | null>
}

export interface MusicCollectionRecord extends MusicCollectionSummary {
  userId: string
  connectorId: string | null
}

export interface MusicTrackInput
  extends Omit<
    MusicLibraryTrack,
    | 'id'
    | 'position'
    | 'addedAt'
    | 'downloadStatus'
    | 'downloadReason'
    | 'downloadProviderCode'
    | 'downloadCheckedAt'
    | 'downloadRecord'
  > {
  addedAt?: string | null
  albumMetadataUpdatedAt?: string | null
}

export interface MusicAlbumMetadata {
  provider: MusicTrackInput['provider']
  externalId: string
  title: string
  artists: string[]
  releaseDate: string | null
  releaseType: string | null
  coverUrl: string | null
  updatedAt: string
}

export type MusicTrackRecord = Omit<
  MusicLibraryTrack,
  | 'position'
  | 'addedAt'
  | 'downloadStatus'
  | 'downloadReason'
  | 'downloadProviderCode'
  | 'downloadCheckedAt'
  | 'downloadRecord'
>

export type MusicAvailabilityProviderDetails = Record<string, string | number | boolean | null>

export interface MusicTrackAvailabilityUpdate {
  trackId: string
  status: MusicDownloadStatus
  reason: MusicAvailabilityReason | null
  providerCode: string | null
  providerDetails: MusicAvailabilityProviderDetails
  checkedAt: string | null
}

export interface MusicCollectionsRepo {
  listLibrary(userId: string, kind: 'playlist' | 'album'): Promise<MusicCollectionSummary[]>
  listForConnector(userId: string, connectorId: string): Promise<MusicCollectionSummary[]>
  get(userId: string, id: string): Promise<MusicCollectionRecord | null>
  getDetails(userId: string, id: string): Promise<MusicCollectionDetails | null>
  getLibraryTrack(userId: string, id: string): Promise<MusicTrackRecord | null>
  getTrack(id: string): Promise<MusicTrackRecord | null>
  getTrackByMediaKey(mediaKey: string): Promise<MusicTrackRecord | null>
  find(userId: string, provider: MusicCollectionProvider, externalId: string): Promise<MusicCollectionRecord | null>
  upsert(
    userId: string,
    input: {
      connectorId: string | null
      kind: MusicCollectionKind
      provider: MusicCollectionProvider
      externalId: string
      title: string
      description: string | null
      coverUrl: string | null
      ownerName: string | null
      trackCount: number
      libraryAddedAt: string | null
      remoteUpdatedAt: string | null
      lastSyncedAt: string | null
    },
  ): Promise<MusicCollectionRecord>
  setLibraryAdded(userId: string, id: string, libraryAddedAt: string | null): Promise<MusicCollectionRecord | null>
  setLibrarySelections(
    userId: string,
    connectorId: string,
    selectedCollectionIds: string[],
    updatedAt: string,
  ): Promise<void>
  updateSnapshot(
    userId: string,
    id: string,
    input: { trackCount: number; lastSyncedAt: string },
  ): Promise<MusicCollectionRecord | null>
  replaceTracks(collectionId: string, tracks: MusicTrackInput[]): Promise<void>
  listAlbumMetadata(
    provider: MusicTrackInput['provider'],
    externalIds: string[],
    staleBefore: string,
  ): Promise<MusicAlbumMetadata[]>
  listTracksForAvailabilityCheck(
    userId: string,
    connectorId: string,
    staleBefore: string,
    limit: number,
  ): Promise<MusicTrackRecord[]>
  setTrackAvailabilities(userId: string, connectorId: string, updates: MusicTrackAvailabilityUpdate[]): Promise<void>
  clearTrackAvailabilities(connectorId: string): Promise<void>
  deleteMissingConnectorCollections(connectorId: string, externalIds: string[]): Promise<void>
  delete(userId: string, id: string): Promise<boolean>
}

export interface MusicDownloadKeyRecord {
  id: string
  keyHash: string
  userId: string
  connectorId: string
  trackId: string
  downloaderId: string
  quality: MusicDownloadQuality
  resourceEncrypted?: string | null
  expiresAt: string
  revokedAt: string | null
  createdAt: string
}

export interface MediaSubscriptionRecord {
  id: string
  userId: string
  subjectType: 'music_collection' | 'movie' | 'tv'
  subjectKey: string
  downloaderId: string | null
  enabled: boolean
  lastEvaluatedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface MediaSubscriptionsRepo {
  find(
    userId: string,
    subjectType: MediaSubscriptionRecord['subjectType'],
    subjectKey: string,
  ): Promise<MediaSubscriptionRecord | null>
  get(id: string): Promise<MediaSubscriptionRecord | null>
  upsertMusicCollection(
    userId: string,
    collectionId: string,
    input: { downloaderId: string; now: string },
  ): Promise<MediaSubscriptionRecord>
  disable(userId: string, id: string, now: string): Promise<MediaSubscriptionRecord | null>
  markEvaluated(id: string, evaluatedAt: string): Promise<void>
}

export interface DownloadRecordConfig {
  preferredQuality: MusicDownloadQuality
  resolvedQuality: MusicDownloadQuality | null
}

export interface DownloadRecordRecord {
  id: string
  userId: string
  resourceKind: 'music_track' | 'movie' | 'tv_episode'
  resourceKey: string
  laneKey: string
  generation: number
  downloaderId: string | null
  config: DownloadRecordConfig
  status: DownloadRecordStatus
  attemptCount: number
  externalTaskId: string | null
  firstAcceptedAt: string | null
  lastAcceptedAt: string | null
  manualRequestedAt: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

export interface DownloadRecordsRepo {
  listByResourceKeys(
    userId: string,
    resourceKind: DownloadRecordRecord['resourceKind'],
    resourceKeys: string[],
  ): Promise<DownloadRecordRecord[]>
  get(id: string): Promise<DownloadRecordRecord | null>
  create(record: DownloadRecordRecord): Promise<boolean>
  createMany(records: DownloadRecordRecord[]): Promise<void>
  linkSubscription(subscriptionId: string, downloadRecordId: string, createdAt: string): Promise<void>
  linkSubscriptionMany(subscriptionId: string, downloadRecordIds: string[], createdAt: string): Promise<void>
  update(
    id: string,
    generation: number,
    patch: Partial<
      Pick<
        DownloadRecordRecord,
        | 'laneKey'
        | 'generation'
        | 'downloaderId'
        | 'config'
        | 'status'
        | 'attemptCount'
        | 'externalTaskId'
        | 'firstAcceptedAt'
        | 'lastAcceptedAt'
        | 'manualRequestedAt'
        | 'errorMessage'
        | 'updatedAt'
      >
    >,
  ): Promise<DownloadRecordRecord | null>
  claimNext(laneKey: string, claimedAt: string): Promise<DownloadRecordRecord | null>
  isWanted(id: string): Promise<boolean>
  cancelUnwantedForSubscription(subscriptionId: string, canceledAt: string): Promise<number>
  hasQueued(laneKey: string): Promise<boolean>
  listRecoverableLaneKeys(): Promise<string[]>
  requeueStalled(laneKey: string | null, staleBefore: string, queuedAt: string): Promise<string[]>
  requeueWaitingForEnabledSubscriptions(queuedAt: string): Promise<string[]>
}

export interface DispatchLaneRecord {
  key: string
  leaseOwner: string | null
  leaseExpiresAt: string | null
  nextAllowedAt: string | null
  updatedAt: string
}

export interface DispatchLanesRepo {
  acquire(
    key: string,
    owner: string,
    acquiredAt: string,
    leaseExpiresAt: string,
  ): Promise<{ lane: DispatchLaneRecord; acquired: boolean }>
  release(key: string, owner: string, nextAllowedAt: string, releasedAt: string): Promise<void>
}

export interface DownloadDispatchQueue {
  wake(laneKey: string, delaySeconds?: number): Promise<void>
}

export interface ConnectorSyncQueue {
  enqueue(input: { userId: string; connectorId: string }): Promise<void>
}

export interface MusicDownloadKeysRepo {
  create(record: MusicDownloadKeyRecord): Promise<void>
  getByHash(keyHash: string): Promise<MusicDownloadKeyRecord | null>
  revoke(id: string, revokedAt: string): Promise<void>
}

export interface UsersRepo {
  isInitialized(): Promise<boolean>
  /** Assigns library rows created before the first admin existed to that admin. */
  adoptOrphanLibraryItems(userId: string): Promise<void>
}

/** Resolved credentials/locale of the enabled media metadata source. */
export interface ActiveMediaSource {
  apiKey: string
  language: string
}

export interface MediaProvider {
  search(source: ActiveMediaSource, query: string): Promise<MediaSearchItem[]>
  trending(source: ActiveMediaSource): Promise<MediaSearchItem[]>
  popular(source: ActiveMediaSource, kind: MediaKind): Promise<MediaSearchItem[]>
  discover(source: ActiveMediaSource, input: Omit<MediaDiscoverInput, 'language'>): Promise<MediaDiscoverPage>
  genres(source: ActiveMediaSource, kind: MediaKind): Promise<MediaGenre[]>
  summary(source: ActiveMediaSource, kind: MediaKind, id: number): Promise<MediaSearchItem>
  details(source: ActiveMediaSource, kind: MediaKind, id: number, watchRegion: string): Promise<MediaDetails>
  season(source: ActiveMediaSource, id: number, seasonNumber: number): Promise<MediaSeasonDetails>
  personCredits(source: ActiveMediaSource, id: number): Promise<MediaPersonCredits>
  watchClickouts(kind: MediaKind, id: number, watchRegion: string): Promise<Record<string, string>>
  /** Throws when the source is unreachable or its credentials are invalid. */
  probe(credentials: Record<string, string>): Promise<void>
}

export class BookProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'BookProviderError'
  }
}

export interface BookProvider {
  search(query: string, page: number, pageSize: number): Promise<ResourcePage<BookSearchItem>>
  discover(input: BookDiscoveryInput): Promise<ResourcePage<BookSearchItem>>
  details(mediaKey: string): Promise<BookDetails>
}

export class MusicProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message)
    this.name = 'MusicProviderError'
  }
}

export interface MusicSearchInput {
  q?: string
  artist?: string
  title?: string
  page: number
  pageSize: number
}

export interface MusicProvider {
  search(input: MusicSearchInput): Promise<ResourcePage<MusicAlbumSearchItem>>
  discover(input: MusicDiscoveryInput): Promise<ResourcePage<MusicSearchItem>>
  details(mediaKey: string): Promise<MusicAlbumDetails>
}

export interface ImportedLibraryEntry {
  sourceId: string
  status: 'wish' | 'collect'
  title: string
  aliases: string[]
  year: string | null
  markedAt: string | null
}

export interface LibraryEntryImporter {
  fetchEntries(profileId: string): Promise<ImportedLibraryEntry[]>
}

export interface ImportedMusicPlaylist {
  externalId: string
  title: string
  description: string | null
  coverUrl: string | null
  ownerName: string | null
  trackCount: number
  remoteUpdatedAt: string | null
}

export interface ImportedMusicTrack extends MusicTrackInput {}

export interface ImportedMusicAlbum {
  externalId: string
  title: string
  artists: string[]
  releaseDate: string | null
  releaseType: string | null
  coverUrl: string | null
}

export interface ConnectedMusicAccount {
  externalAccountId: string
  displayName: string
  avatarUrl: string | null
}

export type MusicSmsLoginResult =
  | { status: 'connected'; cookies: string[]; account: ConnectedMusicAccount }
  | {
      status: 'verification_required'
      cookies: string[]
      verification: { qrCode: string; qrUrl: string; expiresAt: string }
    }

export type MusicQrLoginResult =
  | { status: 'waiting_scan' | 'waiting_confirmation' | 'expired'; cookies: string[] }
  | { status: 'connected'; cookies: string[]; account: ConnectedMusicAccount }
  | {
      status: 'verification_required'
      cookies: string[]
      verification: { qrCode: string; qrUrl: string; expiresAt: string }
    }

export interface MusicPlaylistConnector {
  beginQrLogin(): Promise<{ key: string; qrUrl: string; cookies: string[]; expiresAt: string }>
  checkQrLogin(key: string, cookies: string[]): Promise<MusicQrLoginResult>
  sendSmsCode(input: NeteaseSmsCodeInput): Promise<void>
  loginWithSms(input: NeteaseSmsLoginInput, cookies: string[]): Promise<MusicSmsLoginResult>
  checkRiskVerification(
    qrCode: string,
    cookies: string[],
  ): Promise<{ status: 'waiting_scan' | 'waiting_confirmation' | 'connected' | 'expired'; cookies: string[] }>
  listPlaylists(credentials: string[]): Promise<ImportedMusicPlaylist[]>
  listTracks(credentials: string[], playlistId: string): Promise<ImportedMusicTrack[]>
  getAlbums(credentials: string[], albumIds: string[]): Promise<ImportedMusicAlbum[]>
  checkTrackAvailability(credentials: string[], trackIds: string[]): Promise<MusicTrackAvailabilityCheckResult>
}

export interface MusicTrackAvailabilityCheckResult {
  results: Map<string, MusicTrackAvailabilityResult>
  interrupted: MusicAvailabilityInterruption | null
}

export interface MusicTrackAvailabilityResult {
  status: MusicDownloadStatus
  reason: MusicAvailabilityReason | null
  providerCode: string | null
  providerDetails: MusicAvailabilityProviderDetails
}

export interface MusicAvailabilityInterruption {
  reason: Extract<
    MusicAvailabilityReason,
    'authentication_required' | 'risk_control' | 'rate_limited' | 'provider_error'
  >
  providerCode: string | null
  message: string
}

export interface ResolvedMusicResource {
  url: string
  headers: Record<string, string>
  quality: MusicDownloadQuality
  extension: string
  contentType: string | null
  contentLength: number | null
}

export interface MusicResourceResolver {
  resolve(
    credentials: string[],
    input: { trackId: string; quality: MusicDownloadQuality },
  ): Promise<ResolvedMusicResource>
}

export class MusicResourceUnavailableError extends Error {
  constructor(
    message: string,
    public readonly availability: MusicTrackAvailabilityResult = {
      status: 'unavailable',
      reason: 'provider_unavailable',
      providerCode: null,
      providerDetails: {},
    },
  ) {
    super(message)
    this.name = 'MusicResourceUnavailableError'
  }
}
