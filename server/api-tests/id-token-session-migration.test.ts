import { applyD1Migrations, env } from 'cloudflare:test'
import { expect, it } from 'vitest'

it('preserves existing application sessions while removing temporary logout ID tokens', async () => {
  const db = (env as typeof env & { MIGRATION_DB: D1Database }).MIGRATION_DB
  const migrations = env.TEST_MIGRATIONS
  const addIndex = migrations.findIndex((migration) => migration.name === '20260806232926_eager_sister_grimm.sql')
  const dropIndex = migrations.findIndex((migration) => migration.name === '20260807004314_cynical_lorna_dane.sql')
  expect(addIndex).toBeGreaterThan(0)
  expect(dropIndex).toBeGreaterThan(addIndex)
  await applyD1Migrations(db, migrations.slice(0, addIndex))
  await db.batch([
    db.prepare(
      `INSERT INTO users (id, name, role, disabled, issuer, subject, created_at, updated_at)
       VALUES ('user-1', 'Existing User', 'user', 0, 'https://issuer.test', 'subject-1', 1, 1)`,
    ),
    db.prepare(
      `INSERT INTO application_sessions (id, token_hash, user_id, expires_at, created_at, last_seen_at)
       VALUES ('session-1', 'hash-1', 'user-1', '2027-01-01', '2026-08-06', '2026-08-06')`,
    ),
  ])

  await applyD1Migrations(db, migrations.slice(addIndex, dropIndex))
  await db.prepare("UPDATE application_sessions SET id_token = 'temporary-id-token' WHERE id = 'session-1'").run()
  await applyD1Migrations(db, migrations.slice(dropIndex))

  expect(await db.prepare("SELECT id FROM application_sessions WHERE id = 'session-1'").first()).toEqual({
    id: 'session-1',
  })
  const columns = await db.prepare('PRAGMA table_info(application_sessions)').all<{ name: string }>()
  expect(columns.results.map((column) => column.name)).not.toContain('id_token')
})
