import { env } from 'cloudflare:test'
import { createConnectorSyncJobsRepo } from '@server/adapters/repos/connector-sync-jobs'
import { createDownloadersRepo } from '@server/adapters/repos/downloaders'
import { createIndexersRepo } from '@server/adapters/repos/indexers'
import { createMediaSourcesRepo } from '@server/adapters/repos/media-sources'
import { createResourceApiRepo } from '@server/adapters/repos/resource-api'
import { createDb } from '@server/db/client'
import { enqueueConnectorSync, recoverQueuedConnectorSyncJobs } from '@server/usecases/connectors'
import type { ConnectorSyncJobRecord, ReleaseSearchJobRecord } from '@server/usecases/ports'
import type { DownloadTaskSummary, IndexerSearchItem } from '@shared/types'
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
  expect(await repo.claim(job.id, 'duplicate-worker', '2026-08-04T00:08:00.000Z', '2026-08-04T00:13:00.000Z')).toBe(
    false,
  )
  const result = { capability: 'library.import' as const, scanned: 1, imported: 1, saved: 1, watched: 0, unmatched: 0 }
  expect(await repo.complete(job.id, 'expired-worker', result, '2026-08-04T00:03:00.000Z')).toBe(false)
  expect(await repo.complete(job.id, 'recovery-worker', result, '2026-08-04T00:03:00.000Z')).toBe(true)
  expect(await repo.get(userId, job.id)).toMatchObject({ status: 'completed', result, leaseOwner: null })
})

it('recovers an uncertain first queue delivery with the same durable job and one atomic claim', async () => {
  const repo = createConnectorSyncJobsRepo(createDb(env))
  const userId = crypto.randomUUID()
  const connectorId = crypto.randomUUID()
  await insertUser(userId)
  await insertConnector(connectorId, userId)
  const delivered: Array<{ userId: string; connectorId: string; jobId: string }> = []
  let publicationAttempts = 0
  const deps = {
    connectorsRepo: { get: async () => ({ id: connectorId }) },
    connectorSyncJobsRepo: repo,
    connectorSyncQueue: {
      enqueue: async (message: { userId: string; connectorId: string; jobId: string }) => {
        delivered.push(message)
        publicationAttempts += 1
        if (publicationAttempts === 1) throw new Error('Delivery receipt was lost.')
      },
    },
  } as never

  await expect(enqueueConnectorSync(deps, userId, connectorId, 'uncertain-delivery')).rejects.toThrow()
  const queued = await repo.findByIdempotency(userId, 'uncertain-delivery')
  expect(queued).toMatchObject({ status: 'queued', error: null, completedAt: null })

  const retried = await enqueueConnectorSync(deps, userId, connectorId, 'uncertain-delivery')
  expect(retried.id).toBe(queued?.id)
  expect(delivered).toEqual([
    { userId, connectorId, jobId: retried.id },
    { userId, connectorId, jobId: retried.id },
  ])

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
      `INSERT INTO downloaders
        (id, user_id, description, kind, endpoint, credentials_json, options_json, enabled, health_status, created_at, updated_at)
       VALUES (?, ?, 'Downloader', 'zpan', 'https://zpan.test', '{}', '{}', 1, 'unknown', ?, ?)`,
    ).bind(downloaderId, userId, createdAt, createdAt),
    env.DB.prepare(
      `INSERT INTO indexers
        (id, description, kind, endpoint, credentials_json, options_json, enabled, health_status, created_at, updated_at)
       VALUES (?, 'Indexer', 'prowlarr', 'https://prowlarr.test', '{}', '{}', 1, 'unknown', ?, ?)`,
    ).bind(indexerId, createdAt, createdAt),
    env.DB.prepare(
      `INSERT INTO media_sources
        (id, description, kind, credentials_json, options_json, enabled, health_status, created_at, updated_at)
       VALUES (?, 'Source', 'tmdb', '{}', '{}', 1, 'unknown', ?, ?)`,
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
    healthCheckedAt: newer.checkedAt,
  })
  expect(await indexerRepo.get(indexerId)).toMatchObject({
    healthStatus: 'online',
    healthMessage: 'newer',
    healthCheckedAt: newer.checkedAt,
  })
  expect(await sourceRepo.get(sourceId)).toMatchObject({
    healthStatus: 'online',
    healthMessage: 'newer',
    healthCheckedAt: newer.checkedAt,
  })
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
      `INSERT INTO connector_sync_jobs
        (id, user_id, connector_id, idempotency_key, request_hash, status, created_at)
       VALUES (?, ?, ?, 'wrong-owner', 'hash', 'queued', '2026-08-04T00:00:00.000Z')`,
    )
      .bind(crypto.randomUUID(), otherId, connectorId)
      .run(),
  ).rejects.toThrow()
})

it('converges concurrent D1 release completion and prevents completed-to-failed regression', async () => {
  const repo = createResourceApiRepo(createDb(env))
  const userId = crypto.randomUUID()
  const job: ReleaseSearchJobRecord = {
    id: crypto.randomUUID(),
    userId,
    idempotencyKey: 'concurrent-release',
    requestHash: 'hash',
    mediaKey: 'tmdb:movie:550',
    mediaTitle: 'Fight Club',
    query: 'Fight Club',
    searchType: 'search',
    categories: [],
    status: 'running',
    error: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  }
  await insertUser(userId)
  expect(await repo.createReleaseJob(job)).toBe(true)

  const completedAt = new Date().toISOString()
  expect(await repo.claimReleaseJob(job.id, 'winner', completedAt, '2999-01-01T00:00:00.000Z')).toBe(true)
  expect(await repo.completeReleaseJob(job.id, 'winner', [candidate], completedAt)).toBe(true)
  expect(await repo.failReleaseJob(job.id, 'winner', 'late failure', new Date().toISOString())).toBe(false)

  expect(await repo.getReleaseJob(userId, job.id)).toMatchObject({ status: 'completed', error: null })
  expect(
    await env.DB.prepare('SELECT COUNT(*) AS total FROM release_search_results WHERE job_id = ?').bind(job.id).first(),
  ).toEqual({ total: 1 })
})

it('rejects an expired release worker after a new lease fails the job', async () => {
  const repo = createResourceApiRepo(createDb(env))
  const userId = crypto.randomUUID()
  const now = new Date().toISOString()
  const job: ReleaseSearchJobRecord = {
    id: crypto.randomUUID(),
    userId,
    idempotencyKey: 'lease-race',
    requestHash: 'hash',
    mediaKey: 'tmdb:movie:550',
    mediaTitle: 'Fight Club',
    query: 'Fight Club',
    searchType: 'search',
    categories: [],
    status: 'running',
    error: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    createdAt: now,
    completedAt: null,
  }
  await insertUser(userId)
  await repo.createReleaseJob(job)
  expect(
    await repo.claimReleaseJob(job.id, 'expired-worker', '2026-08-04T00:00:00.000Z', '2026-08-04T00:01:00.000Z'),
  ).toBe(true)
  await env.DB.prepare(
    `INSERT INTO release_search_results (id, job_id, position, payload_json, created_at)
     VALUES (?, ?, 0, ?, ?)`,
  )
    .bind(crypto.randomUUID(), job.id, JSON.stringify(candidate), now)
    .run()
  expect((await repo.listReleaseResults(userId, job.id, 1, 20)).items).toEqual([])
  expect(
    await repo.claimReleaseJob(job.id, 'recovery-worker', '2026-08-04T00:02:00.000Z', '2026-08-04T00:07:00.000Z'),
  ).toBe(true)
  expect(
    await env.DB.prepare('SELECT COUNT(*) AS total FROM release_search_results WHERE job_id = ?').bind(job.id).first(),
  ).toEqual({ total: 0 })

  const [staleCompletion, currentFailure] = await Promise.all([
    repo.completeReleaseJob(job.id, 'expired-worker', [candidate], now),
    repo.failReleaseJob(job.id, 'recovery-worker', 'search failed', now),
  ])
  expect(staleCompletion).toBe(false)
  expect(currentFailure).toBe(true)
  expect(await repo.getReleaseJob(userId, job.id)).toMatchObject({ status: 'failed', error: 'search failed' })
  expect(
    await env.DB.prepare('SELECT COUNT(*) AS total FROM release_search_results WHERE job_id = ?').bind(job.id).first(),
  ).toEqual({ total: 0 })
})

it('enforces monotonic D1 download task transitions under concurrent snapshots', async () => {
  const repo = createResourceApiRepo(createDb(env))
  const userId = crypto.randomUUID()
  const jobId = crypto.randomUUID()
  const resultId = crypto.randomUUID()
  const downloaderId = crypto.randomUUID()
  const taskId = crypto.randomUUID()
  const now = new Date().toISOString()
  await insertUser(userId)
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO release_search_jobs
        (id, user_id, idempotency_key, request_hash, media_key, media_title, query, search_type, categories_json, status, created_at)
       VALUES (?, ?, 'job-key', 'job-hash', 'tmdb:movie:550', 'Fight Club', 'Fight Club', 'search', '[]', 'completed', ?)`,
    ).bind(jobId, userId, now),
    env.DB.prepare(
      `INSERT INTO release_search_results (id, job_id, position, payload_json, created_at)
       VALUES (?, ?, 0, ?, ?)`,
    ).bind(resultId, jobId, JSON.stringify(candidate), now),
    env.DB.prepare(
      `INSERT INTO downloaders
        (id, user_id, description, kind, endpoint, credentials_json, options_json, enabled, health_status, created_at, updated_at)
       VALUES (?, ?, 'ZPan', 'zpan', 'https://zpan.test', '{}', '{}', 1, 'online', ?, ?)`,
    ).bind(downloaderId, userId, now, now),
    env.DB.prepare(
      `INSERT INTO manual_download_tasks
        (id, user_id, idempotency_key, request_hash, release_search_result_id, downloader_id, status, external_task_id, created_at)
       VALUES (?, ?, 'task-key', 'task-hash', ?, ?, 'submitted', 'external-1', ?)`,
    ).bind(taskId, userId, resultId, downloaderId, now),
  ])

  const [terminalApplied, lateRunningApplied] = await Promise.all([
    repo.syncDownloadTask(taskId, snapshot('completed'), 'completed', now),
    (async () => {
      await Promise.resolve()
      return repo.syncDownloadTask(taskId, snapshot('running'), 'running', null)
    })(),
  ])
  const task = await repo.getDownloadTask(userId, taskId)
  expect([terminalApplied, lateRunningApplied]).toContain(true)
  if (terminalApplied) expect(task?.status).toBe('completed')

  if (task?.status === 'running') {
    expect(await repo.syncDownloadTask(taskId, snapshot('completed'), 'completed', now)).toBe(true)
  }
  expect(await repo.syncDownloadTask(taskId, snapshot('running'), 'running', null)).toBe(false)
  expect(await repo.getDownloadTask(userId, taskId)).toMatchObject({ status: 'completed', resultObjectId: 'object-1' })
})

async function insertUser(id: string) {
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO users (id, name, role, disabled, issuer, subject, created_at, updated_at)
     VALUES (?, 'Concurrent user', 'user', 0, 'https://issuer.test', ?, ?, ?)`,
  )
    .bind(id, `subject-${id}`, now, now)
    .run()
}

async function insertConnector(id: string, userId: string) {
  await env.DB.prepare(
    `INSERT INTO connectors
      (id, user_id, kind, external_account_id, display_name, created_at, updated_at)
     VALUES (?, ?, 'douban', ?, 'Concurrent connector', '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z')`,
  )
    .bind(id, userId, `external-${id}`)
    .run()
}

function snapshot(status: 'running' | 'completed'): DownloadTaskSummary {
  return {
    id: 'external-1',
    downloaderId: 'downloader',
    downloaderName: 'ZPan',
    downloaderKind: 'zpan',
    sourceType: 'magnet',
    sourceUri: 'magnet:?xt=urn:btih:abc',
    name: 'Fight Club',
    targetFolder: '/media/Movies',
    category: 'zme:movie',
    tags: [],
    status,
    downloadedBytes: status === 'completed' ? 100 : 50,
    storageUploadedBytes: status === 'completed' ? 100 : 0,
    totalBytes: 100,
    downloadBps: status === 'completed' ? 0 : 10,
    storageUploadBps: 0,
    errorMessage: null,
    outputObjectId: status === 'completed' ? 'object-1' : null,
    downstreamRevision: status === 'completed' ? '2026-08-04T00:02:00.000Z' : '2026-08-04T00:01:00.000Z',
  }
}

const candidate: IndexerSearchItem = {
  id: 'candidate-1',
  downloadTarget: null,
  title: 'Fight.Club.1080p',
  fileName: null,
  indexer: 'Tracker',
  size: 100,
  seeders: 10,
  leechers: 1,
  files: 1,
  protocol: 'torrent',
  publishDate: '2026-08-04T00:00:00.000Z',
  downloadUrl: null,
  magnetUrl: 'magnet:?xt=urn:btih:abc',
  infoUrl: null,
  infoHash: null,
  categories: [],
  categoryIds: [],
  indexerFlags: [],
  imdbId: null,
  tmdbId: 550,
  tvdbId: null,
}
