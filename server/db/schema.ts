import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

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
    kind: text('kind', { enum: ['movie', 'tv'] }).notNull(),
    tmdbId: integer('tmdb_id').notNull(),
    savedAt: text('saved_at'),
    watchedAt: text('watched_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('library_user_media_key_idx').on(table.userId, table.mediaKey)],
)

export const librarySources = sqliteTable(
  'library_sources',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    source: text('source', { enum: ['douban'] }).notNull(),
    profileId: text('profile_id').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    lastSyncedAt: text('last_synced_at'),
    lastError: text('last_error'),
    lastResultJson: text('last_result_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('library_sources_user_source_idx').on(table.userId, table.source)],
)

export type User = typeof user.$inferSelect
export type Downloader = typeof downloaders.$inferSelect
export type NewDownloader = typeof downloaders.$inferInsert
export type Indexer = typeof indexers.$inferSelect
export type NewIndexer = typeof indexers.$inferInsert
export type MediaSource = typeof mediaSources.$inferSelect
export type NewMediaSource = typeof mediaSources.$inferInsert
export type LibraryItem = typeof library.$inferSelect
export type NewLibraryItem = typeof library.$inferInsert
export type LibrarySource = typeof librarySources.$inferSelect
