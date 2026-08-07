import { applyD1Migrations, env } from 'cloudflare:test'
import { expect, it } from 'vitest'

it('preserves existing application sessions when adding the logout ID token', async () => {
  const db = (env as typeof env & { MIGRATION_DB: D1Database }).MIGRATION_DB
  const migrations = env.TEST_MIGRATIONS
  const migrationIndex = migrations.findIndex((migration) => migration.name === '20260806232926_eager_sister_grimm.sql')
  expect(migrationIndex).toBeGreaterThan(0)
  await applyD1Migrations(db, migrations.slice(0, migrationIndex))
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

  await applyD1Migrations(db, migrations.slice(migrationIndex))

  expect(await db.prepare("SELECT id, id_token FROM application_sessions WHERE id = 'session-1'").first()).toEqual({
    id: 'session-1',
    id_token: null,
  })
})
