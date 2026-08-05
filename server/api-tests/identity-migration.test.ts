import { applyD1Migrations, env } from 'cloudflare:test'
import { createIdentityRepo } from '@server/adapters/repos/identity'
import { createDb } from '@server/db/client'
import { expect, it } from 'vitest'

it('preserves legacy users and every representative ownership edge during the OIDC migration', async () => {
  const migrationDb = (env as typeof env & { MIGRATION_DB: D1Database }).MIGRATION_DB
  const migrations = env.TEST_MIGRATIONS
  const identityMigrations = migrations.slice(-7)
  expect(identityMigrations.map((migration) => migration.name)).toEqual([
    '20260804163838_pretty_wonder_man.sql',
    '20260804164145_strange_chimera.sql',
    '20260804173146_fair_iron_monger.sql',
    '20260804182028_amusing_moon_knight.sql',
    '20260804193231_lively_centennial.sql',
    '20260804194251_fine_ma_gnuci.sql',
    '20260804200947_tranquil_mindworm.sql',
  ])

  await applyD1Migrations(migrationDb, migrations.slice(0, -7))
  await migrationDb.batch([
    migrationDb
      .prepare(
        `INSERT INTO user
          (id, name, email, email_verified, image, role, banned, created_at, updated_at)
         VALUES (?, ?, ?, 1, NULL, 'admin', 0, ?, ?)`,
      )
      .bind('legacy-user-1', 'Legacy Owner', 'legacy@example.test', 1_700_000_000_000, 1_700_000_000_000),
    migrationDb
      .prepare(
        `INSERT INTO account
          (id, account_id, provider_id, user_id, password, created_at, updated_at)
         VALUES (?, ?, 'credential', ?, ?, ?, ?)`,
      )
      .bind('legacy-account-1', 'legacy@example.test', 'legacy-user-1', 'legacy-hash', 1, 1),
    migrationDb
      .prepare(
        `INSERT INTO library
          (id, user_id, media_key, kind, tmdb_id, saved_at, created_at, updated_at)
         VALUES (?, ?, ?, 'movie', 550, ?, ?, ?)`,
      )
      .bind('library-1', 'legacy-user-1', 'tmdb:movie:550', '2026-01-01', '2026-01-01', '2026-01-01'),
    migrationDb
      .prepare(
        `INSERT INTO downloaders
          (id, user_id, kind, endpoint, credentials_json, options_json, enabled, health_status, created_at, updated_at)
         VALUES (?, ?, 'qbittorrent', ?, '{}', '{}', 1, 'unknown', ?, ?)`,
      )
      .bind('downloader-1', 'legacy-user-1', 'http://downloader.test', '2026-01-01', '2026-01-01'),
  ])

  await applyD1Migrations(migrationDb, identityMigrations.slice(0, 1))
  await migrationDb.batch([
    migrationDb.prepare(
      `INSERT INTO application_sessions
        (id, token_hash, user_id, expires_at, created_at, last_seen_at)
       VALUES ('app-session-1', 'token-hash-1', 'legacy-user-1', '2027-01-01', '2026-01-01', '2026-01-01')`,
    ),
    migrationDb.prepare(
      `INSERT INTO connectors
        (id, user_id, kind, external_account_id, display_name, created_at, updated_at)
       VALUES ('connector-1', 'legacy-user-1', 'netease', 'external-1', 'Legacy Connector', '2026-01-01', '2026-01-01')`,
    ),
    migrationDb.prepare(
      `INSERT INTO connector_login_attempts
        (id, user_id, kind, method, status, expires_at, created_at, updated_at)
       VALUES ('login-attempt-1', 'legacy-user-1', 'netease', 'qr', 'pending', '2027-01-01', '2026-01-01', '2026-01-01')`,
    ),
    migrationDb.prepare(
      `INSERT INTO music_tracks
        (id, provider, external_id, media_key, title, artists_json, isrcs_json, created_at, updated_at)
       VALUES ('track-1', 'netease', 'track-external-1', 'netease:track:1', 'Legacy Track', '[]', '[]', '2026-01-01', '2026-01-01')`,
    ),
    migrationDb.prepare(
      `INSERT INTO music_releases
        (id, provider, external_id, title, artists_json, release_type, created_at, updated_at)
       VALUES ('release-1', 'netease', 'release-external-1', 'Legacy Release', '[]', 'album', '2026-01-01', '2026-01-01')`,
    ),
    migrationDb.prepare(
      `INSERT INTO music_release_tracks
        (id, release_id, track_id, disc_number, track_number, created_at, updated_at)
       VALUES ('release-track-1', 'release-1', 'track-1', 1, 1, '2026-01-01', '2026-01-01')`,
    ),
    migrationDb.prepare(
      `INSERT INTO music_collections
        (id, user_id, connector_id, kind, provider, external_id, title, track_count, created_at, updated_at)
       VALUES ('collection-1', 'legacy-user-1', 'connector-1', 'album', 'netease', 'collection-external-1', 'Legacy Collection', 1, '2026-01-01', '2026-01-01')`,
    ),
    migrationDb.prepare(
      `INSERT INTO music_collection_tracks
        (collection_id, track_id, release_track_id, position, added_at)
       VALUES ('collection-1', 'track-1', 'release-track-1', 1, '2026-01-01')`,
    ),
    migrationDb.prepare(
      `INSERT INTO music_track_availability
        (user_id, connector_id, track_id, status, provider_details_json, checked_at, updated_at)
       VALUES ('legacy-user-1', 'connector-1', 'track-1', 'available', '{}', '2026-01-01', '2026-01-01')`,
    ),
    migrationDb.prepare(
      `INSERT INTO music_download_keys
        (id, key_hash, user_id, connector_id, track_id, downloader_id, quality, expires_at, created_at)
       VALUES ('download-key-1', 'download-key-hash-1', 'legacy-user-1', 'connector-1', 'track-1', 'downloader-1', 'lossless', '2027-01-01', '2026-01-01')`,
    ),
    migrationDb.prepare(
      `INSERT INTO media_subscriptions
        (id, user_id, subject_type, subject_key, downloader_id, config_json, enabled, created_at, updated_at)
       VALUES ('subscription-1', 'legacy-user-1', 'music_collection', 'collection-1', 'downloader-1', '{}', 1, '2026-01-01', '2026-01-01')`,
    ),
    migrationDb.prepare(
      `INSERT INTO download_records
        (id, user_id, resource_kind, resource_key, lane_key, downloader_id, config_json, status, created_at, updated_at)
       VALUES ('download-record-1', 'legacy-user-1', 'music_track', 'netease:track:1', 'netease:connector-1', 'downloader-1', '{}', 'accepted', '2026-01-01', '2026-01-01')`,
    ),
    migrationDb.prepare(
      `INSERT INTO subscription_download_records (subscription_id, download_record_id, created_at)
       VALUES ('subscription-1', 'download-record-1', '2026-01-01')`,
    ),
    migrationDb.prepare(
      `INSERT INTO release_search_jobs
          (id, user_id, idempotency_key, request_hash, media_key, media_title, query, search_type, categories_json, status, created_at)
         VALUES ('job-1', 'legacy-user-1', 'job-key', 'job-hash', 'tmdb:movie:550', 'Fight Club', 'Fight Club', 'search', '[]', 'completed', '2026-01-01')`,
    ),
    migrationDb.prepare(
      `INSERT INTO release_search_results
        (id, job_id, position, payload_json, created_at)
       VALUES ('result-1', 'job-1', 0, '{"title":"Fight Club","magnetUrl":"magnet:?xt=test"}', '2026-01-01')`,
    ),
    migrationDb.prepare(
      `INSERT INTO manual_download_tasks
        (id, user_id, idempotency_key, request_hash, release_search_result_id, downloader_id, status, created_at)
       VALUES ('task-1', 'legacy-user-1', 'task-key', 'task-hash', 'result-1', 'downloader-1', 'submitted', '2026-01-01')`,
    ),
  ])
  await applyD1Migrations(migrationDb, identityMigrations.slice(1, -1))
  await migrationDb
    .prepare(
      `INSERT INTO connector_sync_jobs
        (id, user_id, connector_id, status, created_at)
       VALUES ('sync-job-1', 'legacy-user-1', 'connector-1', 'queued', '2026-01-01')`,
    )
    .run()
  await applyD1Migrations(migrationDb, identityMigrations.slice(-1))

  const migrated = await migrationDb
    .prepare('SELECT id, name, oidc_email, issuer, subject, role FROM users WHERE id = ?')
    .bind('legacy-user-1')
    .first<Record<string, unknown>>()
  expect(migrated).toEqual({
    id: 'legacy-user-1',
    name: 'Legacy Owner',
    oidc_email: null,
    issuer: null,
    subject: null,
    role: 'admin',
  })
  expect(await migrationDb.prepare('SELECT user_id FROM library WHERE id = ?').bind('library-1').first()).toEqual({
    user_id: 'legacy-user-1',
  })
  expect(
    await migrationDb.prepare('SELECT user_id FROM downloaders WHERE id = ?').bind('downloader-1').first(),
  ).toEqual({
    user_id: 'legacy-user-1',
  })
  expect(
    await migrationDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'account'").first(),
  ).toBeNull()
  expect(
    await migrationDb.prepare('SELECT user_id FROM release_search_jobs WHERE id = ?').bind('job-1').first(),
  ).toEqual({
    user_id: 'legacy-user-1',
  })
  expect(
    await migrationDb
      .prepare('SELECT release_search_result_id FROM manual_download_tasks WHERE id = ?')
      .bind('task-1')
      .first(),
  ).toEqual({ release_search_result_id: 'result-1' })
  expect(
    await migrationDb.prepare('SELECT user_id FROM application_sessions WHERE id = ?').bind('app-session-1').first(),
  ).toEqual({ user_id: 'legacy-user-1' })
  expect(
    await migrationDb
      .prepare('SELECT user_id FROM connector_login_attempts WHERE id = ?')
      .bind('login-attempt-1')
      .first(),
  ).toEqual({ user_id: 'legacy-user-1' })
  expect(await migrationDb.prepare('SELECT user_id FROM connectors WHERE id = ?').bind('connector-1').first()).toEqual({
    user_id: 'legacy-user-1',
  })
  expect(
    await migrationDb
      .prepare(
        'SELECT user_id, connector_id, idempotency_key, request_hash, status, lease_owner, lease_expires_at FROM connector_sync_jobs WHERE id = ?',
      )
      .bind('sync-job-1')
      .first(),
  ).toEqual({
    user_id: 'legacy-user-1',
    connector_id: 'connector-1',
    idempotency_key: 'legacy:sync-job-1',
    request_hash: 'legacy:sync-job-1',
    status: 'queued',
    lease_owner: null,
    lease_expires_at: null,
  })
  expect(
    await migrationDb
      .prepare('SELECT user_id, downloader_id FROM download_records WHERE id = ?')
      .bind('download-record-1')
      .first(),
  ).toEqual({ user_id: 'legacy-user-1', downloader_id: 'downloader-1' })
  expect(
    await migrationDb
      .prepare('SELECT user_id, downloader_id FROM media_subscriptions WHERE id = ?')
      .bind('subscription-1')
      .first(),
  ).toEqual({ user_id: 'legacy-user-1', downloader_id: 'downloader-1' })
  expect(
    await migrationDb
      .prepare('SELECT user_id, connector_id FROM music_collections WHERE id = ?')
      .bind('collection-1')
      .first(),
  ).toEqual({ user_id: 'legacy-user-1', connector_id: 'connector-1' })
  expect(
    await migrationDb
      .prepare('SELECT collection_id, track_id, release_track_id FROM music_collection_tracks WHERE collection_id = ?')
      .bind('collection-1')
      .first(),
  ).toEqual({ collection_id: 'collection-1', track_id: 'track-1', release_track_id: 'release-track-1' })
  expect(
    await migrationDb
      .prepare('SELECT user_id, connector_id, track_id, downloader_id FROM music_download_keys WHERE id = ?')
      .bind('download-key-1')
      .first(),
  ).toEqual({
    user_id: 'legacy-user-1',
    connector_id: 'connector-1',
    track_id: 'track-1',
    downloader_id: 'downloader-1',
  })
  expect(
    await migrationDb
      .prepare('SELECT user_id, connector_id, track_id FROM music_track_availability WHERE connector_id = ?')
      .bind('connector-1')
      .first(),
  ).toEqual({ user_id: 'legacy-user-1', connector_id: 'connector-1', track_id: 'track-1' })
  expect(
    await migrationDb
      .prepare(
        'SELECT subscription_id, download_record_id FROM subscription_download_records WHERE subscription_id = ?',
      )
      .bind('subscription-1')
      .first(),
  ).toEqual({ subscription_id: 'subscription-1', download_record_id: 'download-record-1' })
  expect(
    await migrationDb.prepare('SELECT job_id FROM release_search_results WHERE id = ?').bind('result-1').first(),
  ).toEqual({ job_id: 'job-1' })
  expect(
    await migrationDb
      .prepare('SELECT lease_owner, lease_expires_at FROM release_search_jobs WHERE id = ?')
      .bind('job-1')
      .first(),
  ).toEqual({ lease_owner: null, lease_expires_at: null })
  expect(
    await migrationDb
      .prepare('SELECT downstream_revision FROM manual_download_tasks WHERE id = ?')
      .bind('task-1')
      .first(),
  ).toEqual({ downstream_revision: null })

  const userOwnedTables = await migrationDb
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE '%user_id%'")
    .all<{ name: string }>()
  expect(userOwnedTables.results.map(({ name }) => name).sort()).toEqual(
    [
      'application_sessions',
      'connector_login_attempts',
      'connector_sync_jobs',
      'connectors',
      'download_records',
      'downloaders',
      'library',
      'manual_download_tasks',
      'media_subscriptions',
      'music_collections',
      'music_download_keys',
      'music_track_availability',
      'release_search_jobs',
    ].sort(),
  )
  expect((await migrationDb.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])
  const userColumns = await migrationDb.prepare('PRAGMA table_info(users)').all<{ name: string }>()
  expect(userColumns.results.map(({ name }) => name)).not.toEqual(
    expect.arrayContaining(['email', 'email_verified', 'banned', 'ban_reason', 'ban_expires']),
  )

  const repo = createIdentityRepo(createDb({ ...env, DB: migrationDb }))
  const bound = await repo.resolveUser(
    {
      issuer: 'https://issuer.zme.test',
      subject: 'new-subject',
      name: 'Current Name',
      email: 'current@example.test',
      image: null,
    },
    'legacy-user-1',
    true,
    true,
    '2026-08-04T12:00:00.000Z',
  )
  expect(bound).toMatchObject({ id: 'legacy-user-1', issuer: 'https://issuer.zme.test', subject: 'new-subject' })
  expect(await migrationDb.prepare('SELECT user_id FROM library WHERE id = ?').bind('library-1').first()).toEqual({
    user_id: 'legacy-user-1',
  })
  const demoted = await repo.resolveUser(
    {
      issuer: 'https://issuer.zme.test',
      subject: 'new-subject',
      name: 'Ignored Agent Name',
      email: null,
      image: null,
    },
    undefined,
    false,
    false,
    '2026-08-04T12:01:00.000Z',
  )
  expect(demoted).toMatchObject({ role: 'user', name: 'Current Name', email: 'current@example.test' })
})
