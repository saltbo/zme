import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const downloaders = sqliteTable('downloaders', {
  id: text('id').primaryKey(),
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

export const favorites = sqliteTable(
  'favorites',
  {
    id: text('id').primaryKey(),
    mediaKey: text('media_key').notNull(),
    kind: text('kind', { enum: ['movie', 'tv'] }).notNull(),
    tmdbId: integer('tmdb_id').notNull(),
    title: text('title').notNull(),
    originalTitle: text('original_title').notNull(),
    overview: text('overview').notNull(),
    posterUrl: text('poster_url'),
    backdropUrl: text('backdrop_url'),
    releaseYear: text('release_year'),
    rating: real('rating'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('favorites_media_key_idx').on(table.mediaKey)],
)

export type Downloader = typeof downloaders.$inferSelect
export type NewDownloader = typeof downloaders.$inferInsert
export type Indexer = typeof indexers.$inferSelect
export type NewIndexer = typeof indexers.$inferInsert
export type Favorite = typeof favorites.$inferSelect
export type NewFavorite = typeof favorites.$inferInsert
