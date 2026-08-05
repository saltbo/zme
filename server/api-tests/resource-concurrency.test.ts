import { env } from 'cloudflare:test'
import { createConnectorSyncJobsRepo } from '@server/adapters/repos/connector-sync-jobs'
import { createDownloadersRepo } from '@server/adapters/repos/downloaders'
import { createIndexersRepo } from '@server/adapters/repos/indexers'
import { createMediaSourcesRepo } from '@server/adapters/repos/media-sources'
import { createDb } from '@server/db/client'
import { enqueueConnectorSync, recoverQueuedConnectorSyncJobs } from '@server/usecases/connectors'
import type { ConnectorSyncJobRecord } from '@server/usecases/ports'
import { expect, it, vi } from 'vitest'

it('recovers an expired connector sync lease and rejects stale completion', async () => {
  const repo = createConnectorSyncJobsRepo(createDb(env))
  const userId = crypto.randomUUID()
  const connectorId = crypto.randomUUID()
  const job: ConnectorSyncJobRecord = {
    id: crypto.randomUUID(),
    userId,
    connectorId,
    idempotencyKey: 'connector-sync-once',
    requestHash: 'request-hash',
    status: 'queued',
    result: null,
    error: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    createdAt: '2026-08-04T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
  }
  await insertUser(userId)
  await insertConnector(connectorId, userId)
  expect(await repo.create(job)).toBe(true)
  expect(await repo.create({ ...job, id: crypto.randomUUID() })).toBe(false)
  const enqueue = vi.fn(async () => undefined)
  await expect(
    recoverQueuedConnectorSyncJobs({ connectorSyncJobsRepo: repo, connectorSyncQueue: { enqueue } } as never),
  ).resolves.toBe(1)
  expect(enqueue).toHaveBeenCalledWith({ userId, connectorId, jobId: job.id })
  expect(await repo.claim(job.id, 'expired-worker', '2026-08-04T00:00:00.000Z', '2026-08-04T00:01:00.000Z')).toBe(true)
  expect(await repo.claim(job.id, 'early-worker', '2026-08-04T00:00:30.000Z', '2026-08-04T00:05:30.000Z')).toBe(false)
  expect(await repo.claim(job.id, 'recovery-worker', '2026-08-04T00:02:00.000Z', '2026-08-04T00:07:00.000Z')).toBe(true)
  expect(await repo.renew(job.id, 'recovery-worker', '2026-08-04T00:06:00.000Z', '2026-08-04T00:11:00.000Z')).toBe(true)
  const result = { capability: 'library.import' as const, scanned: 1, imported: 1, saved: 1, watched: 0, unmatched: 0 }
  expect(await repo.complete(job.id, 'expired-worker', result, '2026-08-04T00:03:00.000Z')).toBe(false)
  expect(await repo.complete(job.id, 'recovery-worker', result, '2026-08-04T00:03:00.000Z')).toBe(true)
})

it('recovers an uncertain first queue delivery with the same durable job and one atomic claim', async () => {
  const repo = createConnectorSyncJobsRepo(createDb(env))
  const userId = crypto.randomUUID()
  const connectorId = crypto.randomUUID()
  await insertUser(userId)
  await insertConnector(connectorId, userId)
  let publicationAttempts = 0
  const deps = {
    connectorsRepo: { get: async () => ({ id: connectorId }) },
    connectorSyncJobsRepo: repo,
    connectorSyncQueue: {
      enqueue: async () => {
        publicationAttempts += 1
        if (publicationAttempts === 1) throw new Error('Delivery receipt was lost.')
      },
    },
  } as never
  await expect(enqueueConnectorSync(deps, userId, connectorId, 'uncertain-delivery')).rejects.toThrow()
  const queued = await repo.findByIdempotency(userId, 'uncertain-delivery')
  const retried = await enqueueConnectorSync(deps, userId, connectorId, 'uncertain-delivery')
  expect(retried.id).toBe(queued?.id)
  const claims = await Promise.all([
    repo.claim(retried.id, 'worker-one', '2026-08-04T00:00:00.000Z', '2026-08-04T00:05:00.000Z'),
    repo.claim(retried.id, 'worker-two', '2026-08-04T00:00:00.000Z', '2026-08-04T00:05:00.000Z'),
  ])
  expect(claims.filter(Boolean)).toHaveLength(1)
})

it('keeps health snapshots monotonic when older probes finish last', async () => {
  const db = createDb(env)
  const userId = crypto.randomUUID()
  const downloaderId = crypto.randomUUID()
  const indexerId = crypto.randomUUID()
  const sourceId = crypto.randomUUID()
  const createdAt = '2026-08-04T00:00:00.000Z'
  await insertUser(userId)
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO downloaders (id, user_id, description, kind, endpoint, credentials_json, options_json, enabled, health_status, created_at, updated_at) VALUES (?, ?, 'Downloader', 'zpan', 'https://zpan.test', '{}', '{}', 1, 'unknown', ?, ?)`,
    ).bind(downloaderId, userId, createdAt, createdAt),
    env.DB.prepare(
      `INSERT INTO indexers (id, description, kind, endpoint, credentials_json, options_json, enabled, health_status, created_at, updated_at) VALUES (?, 'Indexer', 'prowlarr', 'https://prowlarr.test', '{}', '{}', 1, 'unknown', ?, ?)`,
    ).bind(indexerId, createdAt, createdAt),
    env.DB.prepare(
      `INSERT INTO media_sources (id, description, kind, credentials_json, options_json, enabled, health_status, created_at, updated_at) VALUES (?, 'Source', 'tmdb', '{}', '{}', 1, 'unknown', ?, ?)`,
    ).bind(sourceId, createdAt, createdAt),
  ])
  const newer = { status: 'online' as const, message: 'newer', checkedAt: '2026-08-04T00:02:00.000Z' }
  const older = { status: 'offline' as const, message: 'older', checkedAt: '2026-08-04T00:01:00.000Z' }
  const downloaderRepo = createDownloadersRepo(db)
  const indexerRepo = createIndexersRepo(db)
  const sourceRepo = createMediaSourcesRepo(db)
  await downloaderRepo.setHealth(userId, downloaderId, newer)
  await downloaderRepo.setHealth(userId, downloaderId, older)
  await indexerRepo.setHealth(indexerId, newer)
  await indexerRepo.setHealth(indexerId, older)
  await sourceRepo.setHealth(sourceId, newer)
  await sourceRepo.setHealth(sourceId, older)
  expect(await downloaderRepo.get(userId, downloaderId)).toMatchObject({
    healthStatus: 'online',
    healthMessage: 'newer',
  })
  expect(await indexerRepo.get(indexerId)).toMatchObject({ healthStatus: 'online', healthMessage: 'newer' })
  expect(await sourceRepo.get(sourceId)).toMatchObject({ healthStatus: 'online', healthMessage: 'newer' })
})

it('enforces connector sync ownership in D1', async () => {
  const ownerId = crypto.randomUUID()
  const otherId = crypto.randomUUID()
  const connectorId = crypto.randomUUID()
  await insertUser(ownerId)
  await insertUser(otherId)
  await insertConnector(connectorId, ownerId)
  await expect(
    env.DB.prepare(
      `INSERT INTO connector_sync_jobs (id, user_id, connector_id, idempotency_key, request_hash, status, created_at) VALUES (?, ?, ?, 'wrong-owner', 'hash', 'queued', '2026-08-04T00:00:00.000Z')`,
    )
      .bind(crypto.randomUUID(), otherId, connectorId)
      .run(),
  ).rejects.toThrow()
})

async function insertUser(id: string) {
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO users (id, name, role, disabled, issuer, subject, created_at, updated_at) VALUES (?, 'Concurrent user', 'user', 0, 'https://issuer.test', ?, ?, ?)`,
  )
    .bind(id, `subject-${id}`, now, now)
    .run()
}

async function insertConnector(id: string, userId: string) {
  await env.DB.prepare(
    `INSERT INTO connectors (id, user_id, kind, external_account_id, display_name, created_at, updated_at) VALUES (?, ?, 'douban', ?, 'Concurrent connector', '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z')`,
  )
    .bind(id, userId, `external-${id}`)
    .run()
}
