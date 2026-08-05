import { applyD1Migrations, env } from 'cloudflare:test'
import { expect, it } from 'vitest'

it('backfills both legacy download stores before removing ephemeral release tables', async () => {
  const db = (env as typeof env & { MIGRATION_DB: D1Database }).MIGRATION_DB
  const migrations = env.TEST_MIGRATIONS
  const first = migrations.findIndex((migration) => migration.name === '20260805180801_flowery_ricochet.sql')
  expect(first).toBeGreaterThan(0)
  await applyD1Migrations(db, migrations.slice(0, first))

  await db.batch([
    db.prepare(
      `INSERT INTO users (id, name, role, disabled, issuer, subject, created_at, updated_at) VALUES ('user-1', 'Owner', 'user', 0, 'https://issuer.test', 'subject-1', 1, 1)`,
    ),
    db.prepare(
      `INSERT INTO downloaders (id, user_id, description, kind, endpoint, credentials_json, options_json, enabled, health_status, created_at, updated_at) VALUES ('downloader-1', 'user-1', 'ZPan', 'zpan', 'https://zpan.test', '{}', '{}', 1, 'online', '2026-08-05', '2026-08-05')`,
    ),
    db.prepare(
      `INSERT INTO release_search_jobs (id, user_id, idempotency_key, request_hash, media_key, media_title, query, search_type, categories_json, status, created_at, completed_at) VALUES ('job-1', 'user-1', 'search-1', 'hash', 'tmdb:movie:550', 'Fight Club', 'Fight Club', 'search', '[]', 'completed', '2026-08-05', '2026-08-05')`,
    ),
    db.prepare(
      `INSERT INTO release_search_results (id, job_id, position, payload_json, created_at) VALUES ('result-1', 'job-1', 0, '{"title":"Fight Club","magnetUrl":"magnet:?xt=urn:btih:test"}', '2026-08-05')`,
    ),
    db.prepare(
      `INSERT INTO manual_download_tasks (id, user_id, idempotency_key, request_hash, release_search_result_id, downloader_id, status, external_task_id, created_at) VALUES ('manual-1', 'user-1', 'manual-key', 'manual-hash', 'result-1', 'downloader-1', 'submitted', 'zpan-manual-1', '2026-08-05')`,
    ),
    db.prepare(
      `INSERT INTO download_records (id, user_id, resource_kind, resource_key, lane_key, downloader_id, config_json, status, external_task_id, created_at, updated_at) VALUES ('music-1', 'user-1', 'music_track', 'netease:track:123', 'music:connector-1', 'downloader-1', '{}', 'accepted', 'zpan-music-1', '2026-08-05', '2026-08-05')`,
    ),
  ])

  await applyD1Migrations(db, migrations.slice(first))

  const downloads = await db
    .prepare('SELECT id, resource_kind, resource_key, external_task_id FROM downloads ORDER BY id')
    .all()
  expect(downloads.results).toEqual([
    { id: 'manual-1', resource_kind: 'release', resource_key: 'tmdb:movie:550', external_task_id: 'zpan-manual-1' },
    {
      id: 'music-1',
      resource_kind: 'music_track',
      resource_key: 'netease:track:123',
      external_task_id: 'zpan-music-1',
    },
  ])
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>()
  expect(tables.results.map((row) => row.name)).not.toEqual(
    expect.arrayContaining([
      'download_records',
      'manual_download_tasks',
      'release_search_jobs',
      'release_search_results',
    ]),
  )
  expect(tables.results.map((row) => row.name)).toContain('download_dispatch_records')
})
