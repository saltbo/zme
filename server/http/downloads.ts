import { InvalidDownloadResourceRefError } from '@server/security/download-resource-ref'
import {
  cancelDownload,
  createDownload,
  deleteDownload,
  getDownload,
  listDownloads,
  resumeDownload,
  suspendDownload,
} from '@server/usecases/downloads'
import type { DownloadRecord } from '@server/usecases/ports'
import { StaleWriteError } from '@server/usecases/ports'
import {
  DownloadManagementUnsupportedError,
  DownloadNotTerminalError,
  IdempotencyConflictError,
  ResourceConflictError,
  ResourceNotFoundError,
  ResourceUpstreamError,
} from '@server/usecases/resource-errors'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from './context'
import { entityTag, ifMatchRevision, problem, setPageLinks } from './protocol'

const createSchema = z.object({
  resourceRef: z.string().trim().min(1).max(8_000),
  downloaderId: z.string().uuid(),
})
const listSchema = z.object({
  status: z
    .enum([
      'queued',
      'resolving',
      'waitingSource',
      'submitting',
      'submitted',
      'running',
      'pausing',
      'paused',
      'resuming',
      'canceling',
      'completed',
      'failed',
      'canceled',
    ])
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})

export function registerDownloadRoutes(routes: Hono<AppEnv>) {
  routes.get('/downloads', async (c) => {
    const parsed = listSchema.safeParse(c.req.query())
    if (!parsed.success) return problem(c, 422, 'validation-error', 'Request validation failed')
    const result = await listDownloads(c.get('deps'), c.get('principal').userId, parsed.data)
    setPageLinks(c, parsed.data, result.total)
    return c.json({
      items: await Promise.all(result.items.map((item) => representation(c, item))),
      pagination: {
        ...parsed.data,
        totalItems: result.total,
        totalPages: Math.ceil(result.total / parsed.data.pageSize),
      },
    })
  })

  routes.post('/downloads', async (c) => {
    const key = c.req.header('Idempotency-Key')?.trim()
    if (!key || key.length > 200) return problem(c, 400, 'idempotency-key-required', 'Idempotency-Key is required')
    const parsed = createSchema.safeParse(await safeJson(c))
    if (!parsed.success) return problem(c, 422, 'validation-error', 'Request validation failed')
    try {
      const item = await createDownload(c.get('deps'), c.env, c.get('principal').userId, key, parsed.data)
      c.header('Location', `${new URL(c.req.url).origin}/api/downloads/${item.id}`)
      setEntityHeaders(c, item.updatedAt)
      return c.json(await representation(c, item), 201)
    } catch (error) {
      return resourceError(c, error)
    }
  })

  routes.get('/downloads/:id', async (c) => {
    const item = await getDownload(c.get('deps'), c.get('principal').userId, c.req.param('id'))
    if (!item) return problem(c, 404, 'not-found', 'Download not found')
    setEntityHeaders(c, item.updatedAt)
    return c.json(await representation(c, item))
  })

  routes.delete('/downloads/:id', async (c) => {
    const revision = requireIfMatch(c)
    if (revision instanceof Response) return revision
    try {
      await deleteDownload(c.get('deps'), c.get('principal').userId, c.req.param('id'), revision)
      return c.body(null, 204)
    } catch (error) {
      return resourceError(c, error)
    }
  })

  routes.get('/downloads/:id/suspension', async (c) => {
    const item = await getDownload(c.get('deps'), c.get('principal').userId, c.req.param('id'))
    if (!item) return problem(c, 404, 'not-found', 'Download not found')
    if (!item.suspensionCreatedAt) return problem(c, 404, 'not-found', 'Download suspension not found')
    setEntityHeaders(c, item.updatedAt)
    return c.json(suspensionRepresentation(c, item))
  })

  routes.put('/downloads/:id/suspension', async (c) => {
    const revision = requireIfMatch(c)
    if (revision instanceof Response) return revision
    try {
      const existing = await getDownload(c.get('deps'), c.get('principal').userId, c.req.param('id'))
      const item = await suspendDownload(c.get('deps'), c.get('principal').userId, c.req.param('id'), revision)
      c.header('Location', `${new URL(c.req.url).origin}/api/downloads/${item.id}/suspension`)
      setEntityHeaders(c, item.updatedAt)
      return existing?.suspensionCreatedAt
        ? c.json(suspensionRepresentation(c, item), 200)
        : c.json(suspensionRepresentation(c, item), 201)
    } catch (error) {
      return resourceError(c, error)
    }
  })

  routes.delete('/downloads/:id/suspension', async (c) => {
    const revision = requireIfMatch(c)
    if (revision instanceof Response) return revision
    try {
      const item = await resumeDownload(c.get('deps'), c.get('principal').userId, c.req.param('id'), revision)
      setEntityHeaders(c, item.updatedAt)
      return c.body(null, 204)
    } catch (error) {
      return resourceError(c, error)
    }
  })

  routes.get('/downloads/:id/cancellation', async (c) => {
    const item = await getDownload(c.get('deps'), c.get('principal').userId, c.req.param('id'))
    if (!item) return problem(c, 404, 'not-found', 'Download not found')
    if (!item.cancellationCreatedAt) return problem(c, 404, 'not-found', 'Download cancellation not found')
    setEntityHeaders(c, item.updatedAt)
    return c.json(cancellationRepresentation(c, item))
  })

  routes.put('/downloads/:id/cancellation', async (c) => {
    const revision = requireIfMatch(c)
    if (revision instanceof Response) return revision
    try {
      const existing = await getDownload(c.get('deps'), c.get('principal').userId, c.req.param('id'))
      const item = await cancelDownload(c.get('deps'), c.get('principal').userId, c.req.param('id'), revision)
      c.header('Location', `${new URL(c.req.url).origin}/api/downloads/${item.id}/cancellation`)
      setEntityHeaders(c, item.updatedAt)
      return existing?.cancellationCreatedAt
        ? c.json(cancellationRepresentation(c, item), 200)
        : c.json(cancellationRepresentation(c, item), 201)
    } catch (error) {
      return resourceError(c, error)
    }
  })
}

function setEntityHeaders(c: Context<AppEnv>, updatedAt: string) {
  c.header('ETag', entityTag(updatedAt))
  c.header('Cache-Control', 'private, no-store, no-transform')
}

async function representation(c: Context<AppEnv>, item: DownloadRecord) {
  const base = `${new URL(c.req.url).origin}/api`
  const downloader = await c.get('deps').downloadersRepo.get(item.userId, item.downloaderId)
  const managementSupported = downloader?.kind === 'zpan' && c.get('deps').downloadTaskGateways.zpan !== undefined
  return {
    id: item.id,
    resourceRef: item.resourceRef,
    resourceKind: item.resourceKind,
    resourceKey: item.resourceKey,
    downloaderId: item.downloaderId,
    downloaderName: downloader?.description ?? downloader?.kind ?? item.downloaderId,
    downloaderKind: downloader?.kind ?? 'aria2',
    managementSupported,
    sourceType: item.spec.sourceType,
    sourceUri: item.spec.uri,
    name: item.spec.title ?? item.resourceKey,
    targetFolder: item.spec.targetFolder ?? '',
    category: item.spec.category ?? null,
    tags: item.spec.tags ?? [],
    status: item.status,
    stage: item.stage,
    externalTaskId: item.externalTaskId,
    downstreamStatus: item.downstreamStatus,
    progress: {
      downloadedBytes: item.downloadedBytes,
      storageUploadedBytes: item.storageUploadedBytes,
      totalBytes: item.totalBytes,
      downloadBps: item.downloadBps,
      storageUploadBps: item.storageUploadBps,
    },
    result:
      item.status === 'completed'
        ? { objectId: item.resultObjectId, name: item.resultName, targetFolder: item.resultTargetFolder }
        : null,
    error: item.error,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    completedAt: item.completedAt,
    links: {
      self: `${base}/downloads/${item.id}`,
      suspension: `${base}/downloads/${item.id}/suspension`,
      cancellation: `${base}/downloads/${item.id}/cancellation`,
      downloader: `${base}/downloaders/${item.downloaderId}`,
    },
  }
}

function suspensionRepresentation(c: Context<AppEnv>, item: DownloadRecord) {
  return {
    downloadId: item.id,
    createdAt: item.suspensionCreatedAt,
    links: { self: `${new URL(c.req.url).origin}/api/downloads/${item.id}/suspension` },
  }
}

function cancellationRepresentation(c: Context<AppEnv>, item: DownloadRecord) {
  return {
    downloadId: item.id,
    createdAt: item.cancellationCreatedAt,
    links: { self: `${new URL(c.req.url).origin}/api/downloads/${item.id}/cancellation` },
  }
}

function requireIfMatch(c: Context<AppEnv>): string | Response {
  const revision = ifMatchRevision(c)
  return revision ?? problem(c, 428, 'precondition-required', 'If-Match is required')
}

function resourceError(c: Context<AppEnv>, error: unknown): Response {
  if (error instanceof InvalidDownloadResourceRefError)
    return problem(c, 422, 'invalid-resource-ref', 'The download resource reference is invalid', error.message)
  if (error instanceof IdempotencyConflictError)
    return problem(c, 409, 'idempotency-conflict', 'Idempotency-Key was reused with different content')
  if (error instanceof ResourceNotFoundError) return problem(c, 404, 'not-found', error.message)
  if (error instanceof StaleWriteError)
    return problem(c, 412, 'precondition-failed', 'The Download changed after it was read')
  if (error instanceof DownloadManagementUnsupportedError)
    return problem(c, 409, 'download-management-unsupported', error.message)
  if (error instanceof DownloadNotTerminalError) return problem(c, 409, 'download-not-terminal', error.message)
  if (error instanceof ResourceConflictError) {
    return problem(c, 409, 'download-conflict', error.message)
  }
  if (error instanceof ResourceUpstreamError) return problem(c, 502, 'downloader-unavailable', error.message)
  throw error
}

async function safeJson(c: Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json()
  } catch {
    return null
  }
}
