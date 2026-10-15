import { env } from 'cloudflare:test'
import { createConnectorLoginAttemptsRepo } from '@server/adapters/repos/connector-login-attempts'
import { createDb } from '@server/db/client'
import { expect, it } from 'vitest'

it('keeps existing login attempts readable and persists accepted challenge response metadata', async () => {
  const now = new Date().toISOString()
  await env.DB.prepare('INSERT INTO users (id, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind('challenge-user', 'Challenge User', 'user', Date.now(), Date.now())
    .run()
  await env.DB.prepare(
    'INSERT INTO connector_login_attempts (id, user_id, kind, method, status, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind('attempt-1', 'challenge-user', 'netease', 'sms', 'pending', '2099-01-01T00:00:00.000Z', now, now)
    .run()
  const repo = createConnectorLoginAttemptsRepo(createDb(env))
  expect(await repo.get('challenge-user', 'attempt-1')).toMatchObject({ responseHash: null, responseSubmittedAt: null })
  await repo.update('challenge-user', 'attempt-1', {
    responseHash: 'salted-private-response-hash',
    responseSubmittedAt: now,
  })
  expect(await repo.get('challenge-user', 'attempt-1')).toMatchObject({
    responseHash: 'salted-private-response-hash',
    responseSubmittedAt: now,
  })
  expect(await repo.get('another-user', 'attempt-1')).toBeNull()
})
