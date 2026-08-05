import { readConfig } from '@server/config'
import { searchMedia } from '@server/usecases/media'
import type {
  ManualDownloadTaskRecord,
  ReleaseSearchJobRecord,
  ReleaseSearchResultRecord,
} from '@server/usecases/ports'
import {
  createManualDownloadTask,
  createReleaseSearchJob,
  getManualDownloadTask,
  getReleaseSearchJob,
  IdempotencyConflictError,
  listDownloadDestinations,
  ResourceConflictError,
  ResourceNotFoundError,
  ResourceUpstreamError,
  releaseResultDetails,
} from '@server/usecases/resource-api'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from './context'
import { openapiDocument } from './openapi'
import { problem, setPageLinks } from './protocol'

const pageSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})
const releaseJobSchema = z.object({
  mediaKey: z.string().trim().min(1).max(200),
  mediaTitle: z.string().trim().min(1).max(300),
  query: z.string().trim().min(1).max(300),
  searchType: z.enum(['search', 'audiosearch', 'booksearch']).optional(),
  categories: z.array(z.number().int().positive()).max(30).optional(),
})
const downloadTaskSchema = z.object({
  releaseSearchResultId: z.string().uuid(),
  downloaderId: z.string().uuid(),
})

export function registerPublicContractRoutes(routes: Hono<AppEnv>) {
  routes.get('/openapi.json', (c) => c.json(openapiDocument(readConfig(c.env))))
}

export function registerResourceApiRoutes(routes: Hono<AppEnv>) {
  routes.get('/media', async (c) => {
    const parsed = z
      .object({
        query: z.string().trim().min(1).max(200),
        language: z.string().trim().max(35).optional(),
        kind: z.enum(['movie', 'tv']).optional(),
      })
      .safeParse(c.req.query())
    if (!parsed.success) return problem(c, 422, 'validation-error', 'Request validation failed')
    const items = (await searchMedia(c.get('deps'), parsed.data.query, parsed.data.language)).filter(
      (item) => !parsed.data.kind || item.kind === parsed.data.kind,
    )
    return c.json({
      items: items.map((item) => ({ ...item, mediaKey: `tmdb:${item.kind}:${item.id}` })),
      pagination: { page: 1, pageSize: items.length, totalItems: items.length, totalPages: items.length ? 1 : 0 },
    })
  })

  routes.get('/download-destinations', async (c) => {
    return c.json({ items: await listDownloadDestinations(c.get('deps'), c.get('principal').userId) })
  })

  routes.post('/release-search-jobs', async (c) => {
    const key = idempotencyKey(c)
    if (!key) return problem(c, 400, 'idempotency-key-required', 'Idempotency-Key is required')
    const parsed = releaseJobSchema.safeParse(await safeJson(c))
    if (!parsed.success) return problem(c, 422, 'validation-error', 'Request validation failed')
    try {
      const job = await createReleaseSearchJob(c.get('deps'), c.get('principal').userId, key, parsed.data)
      c.header('Location', `${readConfig(c.env).resourceUrl}/release-search-jobs/${job.id}`)
      return c.json(releaseJobRepresentation(c, job), 201)
    } catch (error) {
      if (error instanceof IdempotencyConflictError)
        return problem(c, 409, 'idempotency-conflict', 'Idempotency-Key was reused with different content')
      throw error
    }
  })

  routes.get('/release-search-jobs', async (c) => {
    const page = pageSchema.safeParse(c.req.query())
    if (!page.success) return problem(c, 422, 'validation-error', 'Request validation failed')
    const result = await c
      .get('deps')
      .resourceApiRepo.listReleaseJobs(c.get('principal').userId, page.data.page, page.data.pageSize)
    setPageLinks(c, page.data, result.total)
    return c.json(
      pageRepresentation(
        result.items.map((item) => releaseJobRepresentation(c, item)),
        page.data,
        result.total,
      ),
    )
  })

  routes.get('/release-search-jobs/:id', async (c) => {
    const job = await getReleaseSearchJob(c.get('deps'), c.get('principal').userId, c.req.param('id'))
    if (!job) return problem(c, 404, 'not-found', 'Release search job not found')
    return c.json(releaseJobRepresentation(c, job))
  })

  routes.get('/release-search-jobs/:id/results', async (c) => {
    const page = pageSchema.safeParse(c.req.query())
    if (!page.success) return problem(c, 422, 'validation-error', 'Request validation failed')
    const result = await c
      .get('deps')
      .resourceApiRepo.listReleaseResults(
        c.get('principal').userId,
        c.req.param('id'),
        page.data.page,
        page.data.pageSize,
      )
    setPageLinks(c, page.data, result.total)
    return c.json(
      pageRepresentation(
        result.items.map((item) => releaseResultRepresentation(c, item)),
        page.data,
        result.total,
      ),
    )
  })

  routes.get('/release-search-results/:id', async (c) => {
    const result = await c.get('deps').resourceApiRepo.getReleaseResult(c.get('principal').userId, c.req.param('id'))
    if (!result) return problem(c, 404, 'not-found', 'Release search result not found')
    return c.json(releaseResultRepresentation(c, result))
  })

  routes.post('/download-tasks', async (c) => {
    const key = idempotencyKey(c)
    if (!key) return problem(c, 400, 'idempotency-key-required', 'Idempotency-Key is required')
    const parsed = downloadTaskSchema.safeParse(await safeJson(c))
    if (!parsed.success) return problem(c, 422, 'validation-error', 'Request validation failed')
    try {
      const task = await createManualDownloadTask(c.get('deps'), c.get('principal').userId, key, parsed.data)
      c.header('Location', `${readConfig(c.env).resourceUrl}/download-tasks/${task.id}`)
      return c.json(downloadTaskRepresentation(c, task), 201)
    } catch (error) {
      if (error instanceof IdempotencyConflictError)
        return problem(c, 409, 'idempotency-conflict', 'Idempotency-Key was reused with different content')
      if (error instanceof ResourceNotFoundError) return problem(c, 404, 'not-found', error.message)
      if (error instanceof ResourceConflictError) return problem(c, 409, 'resource-conflict', error.message)
      if (error instanceof ResourceUpstreamError) return problem(c, 502, 'downloader-unavailable', error.message)
      throw error
    }
  })

  routes.get('/download-tasks', async (c) => {
    const page = pageSchema.safeParse(c.req.query())
    if (!page.success) return problem(c, 422, 'validation-error', 'Request validation failed')
    const result = await c
      .get('deps')
      .resourceApiRepo.listDownloadTasks(c.get('principal').userId, page.data.page, page.data.pageSize)
    setPageLinks(c, page.data, result.total)
    return c.json(
      pageRepresentation(
        result.items.map((item) => downloadTaskRepresentation(c, item)),
        page.data,
        result.total,
      ),
    )
  })

  routes.get('/download-tasks/:id', async (c) => {
    try {
      const task = await getManualDownloadTask(c.get('deps'), c.get('principal').userId, c.req.param('id'))
      if (!task) return problem(c, 404, 'not-found', 'Download task not found')
      return c.json(downloadTaskRepresentation(c, task))
    } catch (error) {
      if (error instanceof ResourceUpstreamError) return problem(c, 502, 'downloader-unavailable', error.message)
      throw error
    }
  })
}

function releaseJobRepresentation(c: Context<AppEnv>, job: ReleaseSearchJobRecord) {
  const base = readConfig(c.env).resourceUrl
  return {
    id: job.id,
    mediaKey: job.mediaKey,
    mediaTitle: job.mediaTitle,
    query: job.query,
    searchType: job.searchType,
    categories: job.categories,
    status: job.status,
    error: job.error,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    links: { self: `${base}/release-search-jobs/${job.id}`, results: `${base}/release-search-jobs/${job.id}/results` },
  }
}

function releaseResultRepresentation(c: Context<AppEnv>, result: ReleaseSearchResultRecord) {
  const base = readConfig(c.env).resourceUrl
  return {
    ...releaseResultDetails(result),
    links: {
      self: `${base}/release-search-results/${result.id}`,
      job: `${base}/release-search-jobs/${result.jobId}`,
    },
  }
}

function downloadTaskRepresentation(c: Context<AppEnv>, task: ManualDownloadTaskRecord) {
  const base = readConfig(c.env).resourceUrl
  return {
    id: task.id,
    releaseSearchResultId: task.releaseSearchResultId,
    downloaderId: task.downloaderId,
    status: task.status,
    externalTaskId: task.externalTaskId,
    downstreamStatus: task.downstreamStatus,
    progress: {
      downloadedBytes: task.downloadedBytes,
      storageUploadedBytes: task.storageUploadedBytes,
      totalBytes: task.totalBytes,
      downloadBps: task.downloadBps,
      storageUploadBps: task.storageUploadBps,
    },
    result:
      task.status === 'completed'
        ? {
            objectId: task.resultObjectId,
            name: task.resultName,
            targetFolder: task.resultTargetFolder,
          }
        : null,
    error: task.error,
    createdAt: task.createdAt,
    completedAt: task.completedAt,
    links: {
      self: `${base}/download-tasks/${task.id}`,
      releaseSearchResult: `${base}/release-search-results/${task.releaseSearchResultId}`,
    },
  }
}

function pageRepresentation<T>(items: T[], page: { page: number; pageSize: number }, totalItems: number) {
  return { items, pagination: { ...page, totalItems, totalPages: Math.ceil(totalItems / page.pageSize) } }
}

function idempotencyKey(c: Context<AppEnv>): string | null {
  const value = c.req.header('Idempotency-Key')?.trim()
  return value && value.length <= 200 ? value : null
}

async function safeJson(c: Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}
