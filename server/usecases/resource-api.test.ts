import type { IndexerSearchItem } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import type {
  ManualDownloadTaskRecord,
  ReleaseSearchJobRecord,
  ReleaseSearchResultRecord,
  ResourceApiRepo,
} from './ports'
import { DownloadSubmissionRejectedError, DownloadSubmissionUnknownError, IndexerSearchError } from './ports'
import {
  createManualDownloadTask,
  createReleaseSearchJob,
  findMedia,
  getManualDownloadTask,
  getReleaseSearchJob,
  IdempotencyConflictError,
  listDownloadDestinations,
  ResourceConflictError,
  ResourceNotFoundError,
  ResourceUpstreamError,
  releaseResultDetails,
} from './resource-api'

const candidate: IndexerSearchItem = {
  id: 'candidate-1',
  downloadTarget: null,
  title: 'Film.2026.2160p.WEB-DL.x265.DTS',
  fileName: null,
  indexer: 'Tracker',
  size: 8_000_000_000,
  seeders: 42,
  leechers: 3,
  protocol: 'torrent' as const,
  publishDate: '2026-08-01T00:00:00.000Z',
  downloadUrl: null,
  magnetUrl: 'magnet:?xt=urn:btih:abc',
  infoUrl: null,
  infoHash: null,
  files: 1,
  categories: [],
  categoryIds: [],
  indexerFlags: [],
  imdbId: null,
  tmdbId: null,
  tvdbId: null,
}

describe('resource lifecycle use cases', () => {
  let jobs: ReleaseSearchJobRecord[]
  let results: ReleaseSearchResultRecord[]
  let tasks: ManualDownloadTaskRecord[]
  let deps: Deps
  let indexerFailure: Error | null
  let downloaderFailure: Error | null

  beforeEach(() => {
    jobs = []
    results = []
    tasks = []
    indexerFailure = null
    downloaderFailure = null
    deps = {
      resourceApiRepo: memoryRepo(() => ({ jobs, results, tasks })),
      indexersRepo: { listEnabled: async () => [indexerRecord()] },
      indexerGateways: {
        prowlarr: {
          search: async () => {
            if (indexerFailure) throw indexerFailure
            return [candidate]
          },
        },
      },
      downloadersRepo: {
        getEnabled: async (_userId: string, id: string) => (id === 'downloader-1' ? downloaderRecord() : null),
        get: async (_userId: string, id: string) => (id === 'downloader-1' ? downloaderRecord() : null),
        listEnabled: async () => [downloaderRecord()],
      },
      downloaderGateways: {
        zpan: {
          supportedSourceTypes: ['magnet'],
          submit: vi.fn(async () => {
            if (downloaderFailure) throw downloaderFailure
            return { externalTaskId: 'external-1' }
          }),
        },
      },
      downloadTaskGateways: {
        zpan: {
          get: async () => null,
          list: async () => ({ items: [], total: 0, page: 1, pageSize: 50 }),
          stream: async () => {},
        },
      },
      mediaSourcesRepo: { findEnabled: async () => mediaSourceRecord() },
      mediaProvider: { search: vi.fn(async () => [{ id: 550, kind: 'movie', title: 'Film' }]) },
    } as never as Deps
  })

  it('creates, completes, and reuses a release-search job with normalized input', async () => {
    const input = { mediaKey: 'tmdb:movie:550', mediaTitle: 'Film', query: 'Film', categories: [2040, 2000] }
    const created = await createReleaseSearchJob(deps, 'user-1', 'job-key', input)
    const replay = await createReleaseSearchJob(deps, 'user-1', 'job-key', input)

    expect(created).toMatchObject({ status: 'completed', searchType: 'search', categories: [2000, 2040] })
    expect(replay.id).toBe(created.id)
    expect(jobs).toHaveLength(1)
    expect(results).toHaveLength(1)
  })

  it('rejects idempotency-key reuse with different job content', async () => {
    await createReleaseSearchJob(deps, 'user-1', 'job-key', {
      mediaKey: 'movie-1',
      mediaTitle: 'Film',
      query: 'Film',
    })
    await expect(
      createReleaseSearchJob(deps, 'user-1', 'job-key', {
        mediaKey: 'movie-2',
        mediaTitle: 'Other',
        query: 'Other',
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError)
  })

  it('atomically converges concurrent creates with the same idempotency key', async () => {
    const input = { mediaKey: 'movie-1', mediaTitle: 'Film', query: 'Film' }
    const [first, second] = await Promise.all([
      createReleaseSearchJob(deps, 'user-1', 'race-key', input),
      createReleaseSearchJob(deps, 'user-1', 'race-key', input),
    ])
    expect(first.id).toBe(second.id)
    expect(jobs).toHaveLength(1)
  })

  it('persists a failed release-search lifecycle instead of losing the job', async () => {
    indexerFailure = new IndexerSearchError('Indexer unavailable')
    const job = await createReleaseSearchJob(deps, 'user-1', 'failed-key', {
      mediaKey: 'movie-1',
      mediaTitle: 'Film',
      query: 'Film',
    })
    expect(job).toMatchObject({ status: 'failed', error: 'Release search failed.' })
    expect(jobs[0]).toMatchObject({ status: 'failed', error: 'Release search failed.' })
  })

  it('does not turn an unexpected release-search programming error into business state', async () => {
    indexerFailure = new TypeError('unexpected mapper failure')
    await expect(
      createReleaseSearchJob(deps, 'user-1', 'unexpected-key', {
        mediaKey: 'movie-1',
        mediaTitle: 'Film',
        query: 'Film',
      }),
    ).rejects.toThrow('unexpected mapper failure')
    expect(jobs[0]).toMatchObject({ status: 'running', error: null })
  })

  it('recovers an interrupted running release-search job on read', async () => {
    const created = await createReleaseSearchJob(deps, 'user-1', 'job-key', {
      mediaKey: 'movie-1',
      mediaTitle: 'Film',
      query: 'Film',
    })
    Object.assign(jobs[0], { status: 'running', completedAt: null })
    results = []

    await expect(getReleaseSearchJob(deps, 'user-1', created.id)).resolves.toMatchObject({ status: 'completed' })
    expect(results).toHaveLength(1)
    await expect(getReleaseSearchJob(deps, 'user-1', 'missing')).resolves.toBeNull()
  })

  it('leases concurrent recovery so only one read repeats the upstream search', async () => {
    const created = await createReleaseSearchJob(deps, 'user-1', 'job-key', {
      mediaKey: 'movie-1',
      mediaTitle: 'Film',
      query: 'Film',
    })
    Object.assign(jobs[0], { status: 'running', completedAt: null })
    results = []
    let entered = 0
    let releaseSearch!: () => void
    const barrier = new Promise<void>((resolve) => {
      releaseSearch = resolve
    })
    deps.indexerGateways.prowlarr.search = async () => {
      entered += 1
      await barrier
      return [candidate]
    }

    const leasedRecovery = getReleaseSearchJob(deps, 'user-1', created.id)
    await vi.waitFor(() => expect(entered).toBe(1))
    await expect(getReleaseSearchJob(deps, 'user-1', created.id)).resolves.toMatchObject({ status: 'running' })
    releaseSearch()
    await expect(leasedRecovery).resolves.toMatchObject({ status: 'completed' })
    await expect(getReleaseSearchJob(deps, 'user-1', created.id)).resolves.toMatchObject({ status: 'completed' })
    expect(jobs[0].status).toBe('completed')
    expect(results).toHaveLength(1)
    expect(entered).toBe(1)
  })

  it('submits a selected owned release and reuses the resulting download task', async () => {
    await createReleaseSearchJob(deps, 'user-1', 'job-key', {
      mediaKey: 'movie-1',
      mediaTitle: 'Film',
      query: 'Film',
    })
    const input = { releaseSearchResultId: results[0].id, downloaderId: 'downloader-1' }
    const created = await createManualDownloadTask(deps, 'user-1', 'download-key', input)
    const replay = await createManualDownloadTask(deps, 'user-1', 'download-key', input)
    expect(created).toMatchObject({ status: 'submitted', externalTaskId: 'external-1' })
    expect(replay.id).toBe(created.id)
    expect(tasks).toHaveLength(1)
    expect(deps.downloaderGateways.zpan.submit).toHaveBeenCalledWith(expect.anything(), expect.anything(), created.id)
  })

  it('persists downloader rejection as a failed task', async () => {
    await createReleaseSearchJob(deps, 'user-1', 'job-key', {
      mediaKey: 'movie-1',
      mediaTitle: 'Film',
      query: 'Film',
    })
    downloaderFailure = new DownloadSubmissionRejectedError('Downloader rejected task')
    const task = await createManualDownloadTask(deps, 'user-1', 'download-key', {
      releaseSearchResultId: results[0].id,
      downloaderId: 'downloader-1',
    })
    expect(task).toMatchObject({ status: 'failed', error: 'Download submission failed.' })
  })

  it('returns the winning persisted state when submission transitions lose a race', async () => {
    await createReleaseSearchJob(deps, 'user-1', 'job-key', {
      mediaKey: 'movie-1',
      mediaTitle: 'Film',
      query: 'Film',
    })
    deps.resourceApiRepo.markDownloadTaskSubmitted = async () => false
    const interrupted = await createManualDownloadTask(deps, 'user-1', 'download-race', {
      releaseSearchResultId: results[0].id,
      downloaderId: 'downloader-1',
    })
    expect(interrupted.status).toBe('submitting')

    downloaderFailure = new DownloadSubmissionRejectedError('late rejection')
    deps.resourceApiRepo.failDownloadTask = async () => false
    const rejected = await createManualDownloadTask(deps, 'user-1', 'failure-race', {
      releaseSearchResultId: results[0].id,
      downloaderId: 'downloader-1',
    })
    expect(rejected.status).toBe('submitting')

    Object.assign(tasks[0], { createdAt: new Date(Date.now() - 10 * 60_000).toISOString() })
    expect(await getManualDownloadTask(deps, 'user-1', tasks[0].id)).toMatchObject({ status: 'submitting' })
  })

  it('synchronizes downstream progress and terminal result on task reads', async () => {
    await createReleaseSearchJob(deps, 'user-1', 'job-key', {
      mediaKey: 'movie-1',
      mediaTitle: 'Film',
      query: 'Film',
    })
    const created = await createManualDownloadTask(deps, 'user-1', 'download-key', {
      releaseSearchResultId: results[0].id,
      downloaderId: 'downloader-1',
    })
    deps.downloadTaskGateways.zpan = {
      get: async () => ({
        id: 'external-1',
        downloaderId: 'downloader-1',
        downloaderName: 'Primary downloader',
        downloaderKind: 'zpan',
        sourceType: 'magnet',
        sourceUri: candidate.magnetUrl as string,
        name: 'Film.2026',
        targetFolder: '/media/Movies',
        category: 'zme:movie',
        tags: [],
        status: 'completed',
        downloadedBytes: 8_000_000_000,
        storageUploadedBytes: 8_000_000_000,
        totalBytes: 8_000_000_000,
        downloadBps: 0,
        storageUploadBps: 0,
        errorMessage: null,
        outputObjectId: 'object-1',
      }),
      list: async () => ({ items: [], total: 0, page: 1, pageSize: 50 }),
      stream: async () => {},
    }

    const synced = await getManualDownloadTask(deps, 'user-1', created.id)

    expect(synced).toMatchObject({
      status: 'completed',
      downstreamStatus: 'completed',
      downloadedBytes: 8_000_000_000,
      resultObjectId: 'object-1',
      resultName: 'Film.2026',
      resultTargetFolder: '/media/Movies',
      completedAt: expect.any(String),
    })
    expect(tasks[0]).toMatchObject({ status: 'completed', resultObjectId: 'object-1' })
  })

  it('keeps the persisted status when downstream synchronization is not applicable', async () => {
    expect(await getManualDownloadTask(deps, 'user-1', 'missing')).toBeNull()
    await createReleaseSearchJob(deps, 'user-1', 'job-key', {
      mediaKey: 'movie-1',
      mediaTitle: 'Film',
      query: 'Film',
    })
    const task = await createManualDownloadTask(deps, 'user-1', 'download-key', {
      releaseSearchResultId: results[0].id,
      downloaderId: 'downloader-1',
    })

    deps.downloadersRepo.get = async () => null
    expect(await getManualDownloadTask(deps, 'user-1', task.id)).toEqual(task)
    deps.downloadersRepo.get = async () => downloaderRecord()
    expect(await getManualDownloadTask(deps, 'user-1', task.id)).toEqual(task)

    tasks[0].externalTaskId = null
    expect(await getManualDownloadTask(deps, 'user-1', task.id)).toEqual(tasks[0])
  })

  it('keeps an interrupted submission pending until a same-key retry resolves the unknown outcome', async () => {
    await createReleaseSearchJob(deps, 'user-1', 'job-key', {
      mediaKey: 'movie-1',
      mediaTitle: 'Film',
      query: 'Film',
    })
    const task = await createManualDownloadTask(deps, 'user-1', 'download-key', {
      releaseSearchResultId: results[0].id,
      downloaderId: 'downloader-1',
    })
    Object.assign(tasks[0], {
      status: 'submitting',
      externalTaskId: null,
      createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    })

    await expect(getManualDownloadTask(deps, 'user-1', task.id)).resolves.toMatchObject({ status: 'submitting' })
    downloaderFailure = new DownloadSubmissionUnknownError('network timeout')
    await expect(
      createManualDownloadTask(deps, 'user-1', 'download-key', {
        releaseSearchResultId: results[0].id,
        downloaderId: 'downloader-1',
      }),
    ).rejects.toBeInstanceOf(ResourceUpstreamError)
    expect(tasks[0]).toMatchObject({ status: 'submitting', error: null, completedAt: null })
  })

  it('uses exact downstream lookup and maps failed lifecycle state', async () => {
    await createReleaseSearchJob(deps, 'user-1', 'job-key', {
      mediaKey: 'movie-1',
      mediaTitle: 'Film',
      query: 'Film',
    })
    const task = await createManualDownloadTask(deps, 'user-1', 'download-key', {
      releaseSearchResultId: results[0].id,
      downloaderId: 'downloader-1',
    })
    const requested: string[] = []
    deps.downloadTaskGateways.zpan = {
      get: async (_config, _owner, id) => {
        requested.push(id)
        return downstreamTask('failed')
      },
      list: async () => ({ items: [], total: 0, page: 1, pageSize: 50 }),
      stream: async () => {},
    }

    expect(await getManualDownloadTask(deps, 'user-1', task.id)).toMatchObject({
      status: 'failed',
      downstreamStatus: 'failed',
      error: 'remote failure',
      completedAt: expect.any(String),
    })
    expect(requested).toEqual(['external-1'])
  })

  it('does not let a late active snapshot overwrite a terminal task snapshot', async () => {
    await createReleaseSearchJob(deps, 'user-1', 'job-key', {
      mediaKey: 'movie-1',
      mediaTitle: 'Film',
      query: 'Film',
    })
    const task = await createManualDownloadTask(deps, 'user-1', 'download-key', {
      releaseSearchResultId: results[0].id,
      downloaderId: 'downloader-1',
    })
    const resolvers: Array<(snapshot: ReturnType<typeof downstreamTask>) => void> = []
    deps.downloadTaskGateways.zpan = {
      get: async () => new Promise((resolve) => resolvers.push(resolve)),
      list: async () => ({ items: [], total: 0, page: 1, pageSize: 50 }),
      stream: async () => {},
    }

    const lateActive = getManualDownloadTask(deps, 'user-1', task.id)
    const terminal = getManualDownloadTask(deps, 'user-1', task.id)
    await vi.waitFor(() => expect(resolvers).toHaveLength(2))
    resolvers[1](downstreamTask('completed'))
    await expect(terminal).resolves.toMatchObject({ status: 'completed' })
    resolvers[0](downstreamTask('running'))
    await expect(lateActive).resolves.toMatchObject({ status: 'completed' })
    expect(tasks[0].status).toBe('completed')
  })

  it('maps queued, active, and canceled downstream states', async () => {
    await createReleaseSearchJob(deps, 'user-1', 'job-key', {
      mediaKey: 'movie-1',
      mediaTitle: 'Film',
      query: 'Film',
    })
    const task = await createManualDownloadTask(deps, 'user-1', 'download-key', {
      releaseSearchResultId: results[0].id,
      downloaderId: 'downloader-1',
    })
    let status: 'queued' | 'running' | 'canceled' = 'queued'
    deps.downloadTaskGateways.zpan = {
      get: async () => downstreamTask(status),
      list: async () => ({ items: [], total: 0, page: 1, pageSize: 50 }),
      stream: async () => {},
    }

    expect(await getManualDownloadTask(deps, 'user-1', task.id)).toMatchObject({ status: 'submitted' })
    tasks[0].status = 'submitted'
    status = 'running'
    expect(await getManualDownloadTask(deps, 'user-1', task.id)).toMatchObject({ status: 'running' })
    tasks[0].status = 'submitted'
    status = 'canceled'
    expect(await getManualDownloadTask(deps, 'user-1', task.id)).toMatchObject({
      status: 'canceled',
      completedAt: expect.any(String),
    })
  })

  it('returns the persisted task when it is absent downstream and reports upstream failures', async () => {
    await createReleaseSearchJob(deps, 'user-1', 'job-key', {
      mediaKey: 'movie-1',
      mediaTitle: 'Film',
      query: 'Film',
    })
    const task = await createManualDownloadTask(deps, 'user-1', 'download-key', {
      releaseSearchResultId: results[0].id,
      downloaderId: 'downloader-1',
    })
    deps.downloadTaskGateways.zpan = {
      get: async () => null,
      list: async () => ({ items: [], total: 0, page: 1, pageSize: 50 }),
      stream: async () => {},
    }
    expect(await getManualDownloadTask(deps, 'user-1', task.id)).toEqual(task)

    deps.downloadTaskGateways.zpan.get = async () => {
      throw new Error('network unavailable')
    }
    await expect(getManualDownloadTask(deps, 'user-1', task.id)).rejects.toBeInstanceOf(ResourceUpstreamError)
  })

  it('rejects missing, non-downloadable, and conflicting download selections', async () => {
    await expect(
      createManualDownloadTask(deps, 'user-1', 'missing', {
        releaseSearchResultId: 'missing',
        downloaderId: 'downloader-1',
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError)

    results.push({
      id: 'empty',
      jobId: 'job',
      position: 0,
      item: { ...candidate, magnetUrl: null },
      createdAt: '',
    })
    await expect(
      createManualDownloadTask(deps, 'user-1', 'empty', {
        releaseSearchResultId: 'empty',
        downloaderId: 'downloader-1',
      }),
    ).rejects.toBeInstanceOf(ResourceConflictError)

    await createReleaseSearchJob(deps, 'user-1', 'job-key', {
      mediaKey: 'movie-1',
      mediaTitle: 'Film',
      query: 'Film',
    })
    const selected = { releaseSearchResultId: results.at(-1)?.id ?? '', downloaderId: 'downloader-1' }
    await createManualDownloadTask(deps, 'user-1', 'same-key', selected)
    await expect(
      createManualDownloadTask(deps, 'user-1', 'same-key', { ...selected, downloaderId: 'other' }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError)
  })

  it('maps media provider results and exposes selection-relevant candidate facts', async () => {
    expect(await findMedia(deps, 'Film', 'en-US')).toEqual([{ id: 550, kind: 'movie', title: 'Film' }])
    expect(
      releaseResultDetails({ id: 'result-1', jobId: 'job-1', position: 0, item: candidate, createdAt: '' }),
    ).toMatchObject({
      title: candidate.title,
      source: 'Tracker',
      sizeBytes: candidate.size,
      quality: { resolution: '2160p / 4K' },
      encoding: { video: 'x265', audio: 'DTS' },
      availability: { seeders: 42, leechers: 3, protocol: 'torrent' },
    })
  })

  it('lists only credential-free download destination facts', async () => {
    expect(await listDownloadDestinations(deps, 'user-1')).toEqual([
      {
        id: 'downloader-1',
        name: 'Primary downloader',
        kind: 'zpan',
        healthStatus: 'online',
        supportedSourceTypes: ['magnet'],
      },
    ])
  })

  it('does not advertise or accept downloaders without exact task tracking', async () => {
    const untracked = { ...downloaderRecord(), id: 'qb-1', kind: 'qbittorrent' as const }
    deps.downloadersRepo.listEnabled = async () => [downloaderRecord(), untracked]
    deps.downloadersRepo.getEnabled = async (_userId, id) => (id === untracked.id ? untracked : downloaderRecord())
    deps.downloaderGateways.qbittorrent = {
      supportedSourceTypes: ['magnet'],
      submit: async () => ({ externalTaskId: 'qb-task' }),
      probe: async () => {},
    }
    expect(await listDownloadDestinations(deps, 'user-1')).toHaveLength(1)

    await createReleaseSearchJob(deps, 'user-1', 'job-key', {
      mediaKey: 'movie-1',
      mediaTitle: 'Film',
      query: 'Film',
    })
    await expect(
      createManualDownloadTask(deps, 'user-1', 'download-key', {
        releaseSearchResultId: results[0].id,
        downloaderId: untracked.id,
      }),
    ).rejects.toBeInstanceOf(ResourceConflictError)
  })
})

function memoryRepo(
  state: () => {
    jobs: ReleaseSearchJobRecord[]
    results: ReleaseSearchResultRecord[]
    tasks: ManualDownloadTaskRecord[]
  },
): ResourceApiRepo {
  return {
    findReleaseJobByIdempotency: async (userId, key) =>
      state().jobs.find((item) => item.userId === userId && item.idempotencyKey === key) ?? null,
    createReleaseJob: async (record) => {
      if (state().jobs.some((item) => item.userId === record.userId && item.idempotencyKey === record.idempotencyKey)) {
        return false
      }
      state().jobs.push(record)
      return true
    },
    claimReleaseJob: async (id, leaseOwner, now, leaseExpiresAt) => {
      const job = state().jobs.find((item) => item.id === id)
      if (
        job?.status !== 'running' ||
        (job.leaseExpiresAt !== null && Date.parse(job.leaseExpiresAt) >= Date.parse(now))
      ) {
        return false
      }
      Object.assign(job, { leaseOwner, leaseExpiresAt })
      return true
    },
    completeReleaseJob: async (id, leaseOwner, items, completedAt) => {
      const job = state().jobs.find((item) => item.id === id)
      if (job?.status !== 'running' || job.leaseOwner !== leaseOwner) return false
      const additions = items
        .map((item, position) => ({
          id: `result-${state().results.length + position}`,
          jobId: id,
          position,
          item,
          createdAt: completedAt,
        }))
        .filter(
          (candidate) =>
            !state().results.some(
              (existing) => existing.jobId === candidate.jobId && existing.position === candidate.position,
            ),
        )
      state().results.push(...additions)
      Object.assign(job, { status: 'completed', completedAt, leaseOwner: null, leaseExpiresAt: null })
      return true
    },
    failReleaseJob: async (id, leaseOwner, error, completedAt) => {
      const job = state().jobs.find((item) => item.id === id)
      if (job?.status !== 'running' || job.leaseOwner !== leaseOwner) return false
      Object.assign(job, { status: 'failed', error, completedAt, leaseOwner: null, leaseExpiresAt: null })
      return true
    },
    getReleaseJob: async (userId, id) => state().jobs.find((item) => item.userId === userId && item.id === id) ?? null,
    listReleaseJobs: async () => ({ items: state().jobs, total: state().jobs.length }),
    listReleaseResults: async () => ({ items: state().results, total: state().results.length }),
    getReleaseResult: async (userId, id) => {
      const result = state().results.find((item) => item.id === id)
      const job = result && state().jobs.find((item) => item.id === result.jobId && item.userId === userId)
      return result && (job || result.jobId === 'job') ? result : null
    },
    findDownloadTaskByIdempotency: async (userId, key) =>
      state().tasks.find((item) => item.userId === userId && item.idempotencyKey === key) ?? null,
    createDownloadTask: async (record) => {
      if (
        state().tasks.some((item) => item.userId === record.userId && item.idempotencyKey === record.idempotencyKey)
      ) {
        return false
      }
      state().tasks.push(record)
      return true
    },
    markDownloadTaskSubmitted: async (id, result) => {
      const task = state().tasks.find((item) => item.id === id)
      if (task?.status !== 'submitting') return false
      Object.assign(task, { status: 'submitted', externalTaskId: result.externalTaskId })
      return true
    },
    syncDownloadTask: async (id, snapshot, status, completedAt) => {
      const task = state().tasks.find((item) => item.id === id)
      const allowed = status === 'submitted' ? ['submitted'] : ['submitted', 'running']
      if (!task || !allowed.includes(task.status)) return false
      if (
        snapshot.downstreamRevision &&
        task.downstreamRevision &&
        snapshot.downstreamRevision <= task.downstreamRevision
      ) {
        return false
      }
      if (
        !snapshot.downstreamRevision &&
        (snapshot.downloadedBytes < task.downloadedBytes || snapshot.storageUploadedBytes < task.storageUploadedBytes)
      ) {
        return false
      }
      Object.assign(task, {
        status,
        downstreamStatus: snapshot.status,
        downstreamRevision: snapshot.downstreamRevision ?? null,
        downloadedBytes: snapshot.downloadedBytes,
        storageUploadedBytes: snapshot.storageUploadedBytes,
        totalBytes: snapshot.totalBytes,
        downloadBps: snapshot.downloadBps,
        storageUploadBps: snapshot.storageUploadBps,
        resultObjectId: snapshot.outputObjectId ?? null,
        resultName: status === 'completed' ? snapshot.name : null,
        resultTargetFolder: status === 'completed' ? snapshot.targetFolder : null,
        error: snapshot.errorMessage,
        completedAt,
      })
      return true
    },
    failDownloadTask: async (id, error, completedAt) => {
      const task = state().tasks.find((item) => item.id === id)
      if (task?.status !== 'submitting') return false
      Object.assign(task, { status: 'failed', error, completedAt })
      return true
    },
    getDownloadTask: async (userId, id) =>
      state().tasks.find((item) => item.userId === userId && item.id === id) ?? null,
    listDownloadTasks: async () => ({ items: state().tasks, total: state().tasks.length }),
  }
}

function indexerRecord() {
  return {
    id: 'indexer-1',
    kind: 'prowlarr' as const,
    config: { endpoint: 'https://indexer.test', credentials: {}, options: {} },
    enabled: true,
  }
}

function downloaderRecord() {
  return {
    id: 'downloader-1',
    description: 'Primary downloader',
    kind: 'zpan' as const,
    config: { endpoint: 'https://downloader.test', credentials: {}, options: {} },
    enabled: true,
    healthStatus: 'online' as const,
    healthMessage: null,
    healthCheckedAt: null,
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
  }
}

function mediaSourceRecord() {
  return {
    id: 'media-source-1',
    kind: 'tmdb' as const,
    credentials: { apiKey: 'key' },
    options: { language: 'en-US' },
    enabled: true,
  }
}

function downstreamTask(status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled', id = 'external-1') {
  return {
    id,
    downloaderId: 'downloader-1',
    downloaderName: 'Primary downloader',
    downloaderKind: 'zpan' as const,
    sourceType: 'magnet' as const,
    sourceUri: candidate.magnetUrl as string,
    name: 'Film.2026',
    targetFolder: '/media/Movies',
    category: 'zme:movie',
    tags: [],
    status,
    downloadedBytes: 10,
    storageUploadedBytes: 5,
    totalBytes: 100,
    downloadBps: 2,
    storageUploadBps: 1,
    errorMessage: status === 'failed' ? 'remote failure' : null,
    outputObjectId: status === 'completed' ? 'object-1' : null,
  }
}
