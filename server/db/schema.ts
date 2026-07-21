import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  role: text('role').default('user'),
  banned: integer('banned', { mode: 'boolean' }).default(false),
  banReason: text('ban_reason'),
  banExpires: integer('ban_expires', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  impersonatedBy: text('impersonated_by'),
})

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
})

export const downloaders = sqliteTable('downloaders', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  description: text('description'),
  kind: text('kind', { enum: ['zpan', 'qbittorrent', 'transmission', 'aria2'] }).notNull(),
  endpoint: text('endpoint').notNull(),
  credentialsJson: text('credentials_json').notNull().default('{}'),
  optionsJson: text('options_json').notNull().default('{}'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  healthStatus: text('health_status', { enum: ['unknown', 'online', 'offline'] })
    .notNull()
    .default('unknown'),
  healthMessage: text('health_message'),
  healthCheckedAt: text('health_checked_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const indexers = sqliteTable('indexers', {
  id: text('id').primaryKey(),
  description: text('description'),
  kind: text('kind', { enum: ['prowlarr'] }).notNull(),
  endpoint: text('endpoint').notNull(),
  credentialsJson: text('credentials_json').notNull().default('{}'),
  optionsJson: text('options_json').notNull().default('{}'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  healthStatus: text('health_status', { enum: ['unknown', 'online', 'offline'] })
    .notNull()
    .default('unknown'),
  healthMessage: text('health_message'),
  healthCheckedAt: text('health_checked_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const mediaSources = sqliteTable('media_sources', {
  id: text('id').primaryKey(),
  description: text('description'),
  kind: text('kind', { enum: ['tmdb'] }).notNull(),
  credentialsJson: text('credentials_json').notNull().default('{}'),
  optionsJson: text('options_json').notNull().default('{}'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  healthStatus: text('health_status', { enum: ['unknown', 'online', 'offline'] })
    .notNull()
    .default('unknown'),
  healthMessage: text('health_message'),
  healthCheckedAt: text('health_checked_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const library = sqliteTable(
  'library',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    mediaKey: text('media_key').notNull(),
    kind: text('kind', { enum: ['movie', 'tv', 'music', 'book'] }).notNull(),
    tmdbId: integer('tmdb_id'),
    savedAt: text('saved_at'),
    watchedAt: text('watched_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('library_user_media_key_idx').on(table.userId, table.mediaKey)],
)

export const connectors = sqliteTable(
  'connectors',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    externalAccountId: text('external_account_id').notNull(),
    displayName: text('display_name').notNull().default(''),
    avatarUrl: text('avatar_url'),
    settingsJson: text('settings_json').notNull().default('{}'),
    credentialsEncrypted: text('credentials_encrypted'),
    status: text('status', { enum: ['connected', 'reauth_required', 'error'] })
      .notNull()
      .default('connected'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    lastSyncedAt: text('last_synced_at'),
    lastError: text('last_error'),
    lastResultJson: text('last_result_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('connectors_user_kind_idx').on(table.userId, table.kind)],
)

export const connectorLoginAttempts = sqliteTable('connector_login_attempts', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  externalKey: text('external_key').notNull(),
  credentialsEncrypted: text('credentials_encrypted'),
  status: text('status', { enum: ['waiting_scan', 'waiting_confirmation', 'connected', 'expired'] })
    .notNull()
    .default('waiting_scan'),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const musicCollections = sqliteTable(
  'music_collections',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    connectorId: text('connector_id').references(() => connectors.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['playlist', 'album', 'favorites'] }).notNull(),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    coverUrl: text('cover_url'),
    ownerName: text('owner_name'),
    trackCount: integer('track_count').notNull().default(0),
    libraryAddedAt: text('library_added_at'),
    remoteUpdatedAt: text('remote_updated_at'),
    lastSyncedAt: text('last_synced_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('music_collections_user_provider_external_idx').on(table.userId, table.provider, table.externalId),
  ],
)

export const musicTracks = sqliteTable(
  'music_tracks',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    mediaKey: text('media_key').notNull(),
    title: text('title').notNull(),
    artistsJson: text('artists_json').notNull().default('[]'),
    coverUrl: text('cover_url'),
    durationMs: integer('duration_ms'),
    isrcsJson: text('isrcs_json').notNull().default('[]'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('music_tracks_provider_external_idx').on(table.provider, table.externalId),
    uniqueIndex('music_tracks_media_key_idx').on(table.mediaKey),
  ],
)

export const musicReleases = sqliteTable(
  'music_releases',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    artistsJson: text('artists_json').notNull().default('[]'),
    releaseDate: text('release_date'),
    releaseType: text('release_type', {
      enum: ['album', 'single', 'ep', 'compilation', 'soundtrack', 'live', 'broadcast', 'other', 'unknown'],
    })
      .notNull()
      .default('unknown'),
    providerReleaseType: text('provider_release_type'),
    coverUrl: text('cover_url'),
    metadataUpdatedAt: text('metadata_updated_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('music_releases_provider_external_idx').on(table.provider, table.externalId)],
)

export const musicReleaseTracks = sqliteTable(
  'music_release_tracks',
  {
    id: text('id').primaryKey(),
    releaseId: text('release_id')
      .notNull()
      .references(() => musicReleases.id, { onDelete: 'cascade' }),
    trackId: text('track_id')
      .notNull()
      .references(() => musicTracks.id, { onDelete: 'cascade' }),
    discNumber: integer('disc_number'),
    trackNumber: integer('track_number'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('music_release_tracks_release_track_idx').on(table.releaseId, table.trackId)],
)

export const musicCollectionTracks = sqliteTable(
  'music_collection_tracks',
  {
    collectionId: text('collection_id')
      .notNull()
      .references(() => musicCollections.id, { onDelete: 'cascade' }),
    trackId: text('track_id')
      .notNull()
      .references(() => musicTracks.id, { onDelete: 'cascade' }),
    releaseTrackId: text('release_track_id').references(() => musicReleaseTracks.id, { onDelete: 'set null' }),
    position: integer('position').notNull(),
    addedAt: text('added_at'),
  },
  (table) => [uniqueIndex('music_collection_tracks_collection_position_idx').on(table.collectionId, table.position)],
)

export const musicTrackAvailability = sqliteTable(
  'music_track_availability',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    connectorId: text('connector_id')
      .notNull()
      .references(() => connectors.id, { onDelete: 'cascade' }),
    trackId: text('track_id')
      .notNull()
      .references(() => musicTracks.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['available', 'unavailable', 'unknown'] }).notNull(),
    reason: text('reason', {
      enum: [
        'membership_required',
        'purchase_required',
        'trial_only',
        'region_restricted',
        'removed_or_unlicensed',
        'authentication_required',
        'risk_control',
        'rate_limited',
        'provider_unavailable',
        'provider_error',
        'malformed_response',
      ],
    }),
    providerCode: text('provider_code'),
    providerDetailsJson: text('provider_details_json').notNull().default('{}'),
    checkedAt: text('checked_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('music_track_availability_connector_track_idx').on(table.connectorId, table.trackId),
    index('music_track_availability_connector_checked_idx').on(table.connectorId, table.checkedAt),
  ],
)

export const musicDownloadKeys = sqliteTable(
  'music_download_keys',
  {
    id: text('id').primaryKey(),
    keyHash: text('key_hash').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    connectorId: text('connector_id')
      .notNull()
      .references(() => connectors.id, { onDelete: 'cascade' }),
    trackId: text('track_id')
      .notNull()
      .references(() => musicTracks.id, { onDelete: 'cascade' }),
    downloaderId: text('downloader_id')
      .notNull()
      .references(() => downloaders.id, { onDelete: 'cascade' }),
    quality: text('quality', { enum: ['standard', 'exhigh', 'lossless', 'hires'] }).notNull(),
    resourceEncrypted: text('resource_encrypted'),
    expiresAt: text('expires_at').notNull(),
    revokedAt: text('revoked_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('music_download_keys_key_hash_idx').on(table.keyHash)],
)

export const mediaSubscriptions = sqliteTable(
  'media_subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    subjectType: text('subject_type', { enum: ['music_collection', 'movie', 'tv'] }).notNull(),
    subjectKey: text('subject_key').notNull(),
    downloaderId: text('downloader_id').references(() => downloaders.id, { onDelete: 'set null' }),
    configJson: text('config_json').notNull().default('{}'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    lastEvaluatedAt: text('last_evaluated_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('media_subscriptions_user_subject_idx').on(table.userId, table.subjectType, table.subjectKey),
  ],
)

export const downloadRecords = sqliteTable(
  'download_records',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    resourceKind: text('resource_kind', { enum: ['music_track', 'movie', 'tv_episode'] }).notNull(),
    resourceKey: text('resource_key').notNull(),
    laneKey: text('lane_key').notNull(),
    generation: integer('generation').notNull().default(1),
    downloaderId: text('downloader_id').references(() => downloaders.id, { onDelete: 'set null' }),
    configJson: text('config_json').notNull().default('{}'),
    status: text('status', {
      enum: ['queued', 'resolving', 'waiting_source', 'submitting', 'accepted', 'failed', 'canceled'],
    })
      .notNull()
      .default('queued'),
    attemptCount: integer('attempt_count').notNull().default(0),
    externalTaskId: text('external_task_id'),
    firstAcceptedAt: text('first_accepted_at'),
    lastAcceptedAt: text('last_accepted_at'),
    manualRequestedAt: text('manual_requested_at'),
    errorMessage: text('error_message'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('download_records_user_resource_idx').on(table.userId, table.resourceKind, table.resourceKey),
    index('download_records_status_idx').on(table.status, table.updatedAt),
  ],
)

export const subscriptionDownloadRecords = sqliteTable(
  'subscription_download_records',
  {
    subscriptionId: text('subscription_id')
      .notNull()
      .references(() => mediaSubscriptions.id, { onDelete: 'cascade' }),
    downloadRecordId: text('download_record_id')
      .notNull()
      .references(() => downloadRecords.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('subscription_download_records_pair_idx').on(table.subscriptionId, table.downloadRecordId),
    index('subscription_download_records_record_idx').on(table.downloadRecordId),
  ],
)

export const dispatchLanes = sqliteTable('dispatch_lanes', {
  key: text('key').primaryKey(),
  leaseOwner: text('lease_owner'),
  leaseExpiresAt: text('lease_expires_at'),
  nextAllowedAt: text('next_allowed_at'),
  updatedAt: text('updated_at').notNull(),
})

export type User = typeof user.$inferSelect
export type Downloader = typeof downloaders.$inferSelect
export type NewDownloader = typeof downloaders.$inferInsert
export type Indexer = typeof indexers.$inferSelect
export type NewIndexer = typeof indexers.$inferInsert
export type MediaSource = typeof mediaSources.$inferSelect
export type NewMediaSource = typeof mediaSources.$inferInsert
export type LibraryItem = typeof library.$inferSelect
export type NewLibraryItem = typeof library.$inferInsert
export type Connector = typeof connectors.$inferSelect
export type ConnectorLoginAttempt = typeof connectorLoginAttempts.$inferSelect
export type MusicCollection = typeof musicCollections.$inferSelect
export type MusicTrackRow = typeof musicTracks.$inferSelect
export type MusicReleaseRow = typeof musicReleases.$inferSelect
export type MusicReleaseTrackRow = typeof musicReleaseTracks.$inferSelect
export type MusicDownloadKey = typeof musicDownloadKeys.$inferSelect
export type MediaSubscription = typeof mediaSubscriptions.$inferSelect
export type DownloadRecord = typeof downloadRecords.$inferSelect
export type DispatchLane = typeof dispatchLanes.$inferSelect
