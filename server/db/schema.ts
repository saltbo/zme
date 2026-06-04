import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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

export type Downloader = typeof downloaders.$inferSelect
export type NewDownloader = typeof downloaders.$inferInsert
