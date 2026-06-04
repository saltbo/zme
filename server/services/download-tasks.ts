import type { DownloaderKind, DownloadTaskPage, DownloadTaskStatus, DownloadTaskSummary } from '@shared/types'
import { and, eq } from 'drizzle-orm'
import type { createDb } from '../db/client'
import { type Downloader, downloaders } from '../db/schema'
import { ZpanClient, type ZpanDownloadTask, type ZpanDownloadTaskPage } from './zpan-client'

type Db = ReturnType<typeof createDb>
type DownloadTaskSnapshot = { items: DownloadTaskSummary[] }
type DownloadTaskEvent =
  | { event: 'snapshot'; data: DownloadTaskSnapshot }
  | { event: 'error'; data: { message: string } }

interface ZpanCredentials {
  apiKey?: string
}

export interface ListDownloadTasksInput {
  status?: DownloadTaskStatus
  page: number
  pageSize: number
}

export async function listDownloadTasks(
  db: Db,
  userId: string,
  input: ListDownloadTasksInput,
): Promise<DownloadTaskPage> {
  const rows = await listEnabledDownloaders(db, userId)

  const results = await Promise.all(rows.map((downloader) => listZpanTasks(downloader, input)))
  return {
    items: results.flatMap((result) => result.items),
    total: results.reduce((sum, result) => sum + result.total, 0),
    page: input.page,
    pageSize: input.pageSize,
  }
}

export async function streamDownloadTaskEvents(db: Db, userId: string, signal: AbortSignal): Promise<Response> {
  const rows = await listEnabledDownloaders(db, userId)
  const encoder = new TextEncoder()
  const latestByDownloader = new Map<string, DownloadTaskSummary[]>()
  let abortController: AbortController | null = null
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      abortController?.abort()
    },
    start(controller) {
      const send = (event: DownloadTaskEvent['event'], data: DownloadTaskEvent['data']) => {
        if (closed) return
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      const sendSnapshot = () => {
        send('snapshot', { items: [...latestByDownloader.values()].flat() })
      }

      if (rows.length === 0) {
        sendSnapshot()
        controller.close()
        return
      }

      abortController = new AbortController()
      const close = () => {
        if (closed) return
        closed = true
        abortController?.abort()
        controller.close()
      }
      signal.addEventListener('abort', close, { once: true })

      let activeStreams = rows.length
      const finishStream = () => {
        activeStreams -= 1
        if (activeStreams <= 0) close()
      }

      for (const downloader of rows) {
        void streamZpanTasks(downloader, abortController.signal, (event) => {
          if (event.event === 'snapshot') {
            latestByDownloader.set(downloader.id, event.data.items)
            sendSnapshot()
            return
          }
          send('error', { message: `${getDownloaderName(downloader)}: ${event.data.message}` })
        })
          .catch((error) => {
            if (!abortController?.signal.aborted) {
              send('error', { message: `${getDownloaderName(downloader)}: ${getErrorMessage(error)}` })
            }
          })
          .finally(() => {
            finishStream()
          })
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

async function listEnabledDownloaders(db: Db, userId: string): Promise<Downloader[]> {
  return db
    .select()
    .from(downloaders)
    .where(and(eq(downloaders.userId, userId), eq(downloaders.enabled, true), eq(downloaders.kind, 'zpan')))
}

async function listZpanTasks(downloader: Downloader, input: ListDownloadTasksInput): Promise<DownloadTaskPage> {
  const payload = await getZpanClient(downloader).listDownloadTasks({
    page: input.page,
    pageSize: input.pageSize,
    status: input.status,
  })
  return {
    items: payload.items.map((task) => toTaskSummary(downloader, task)),
    total: payload.total,
    page: payload.page,
    pageSize: payload.pageSize,
  }
}

async function streamZpanTasks(
  downloader: Downloader,
  signal: AbortSignal,
  emit: (event: DownloadTaskEvent) => void,
): Promise<void> {
  await getZpanClient(downloader).streamDownloadTaskEvents({ page: 1, pageSize: 50 }, signal, (event) => {
    if (event.event === 'snapshot') {
      const payload = event.data as ZpanDownloadTaskPage
      emit({ event: 'snapshot', data: { items: payload.items.map((task) => toTaskSummary(downloader, task)) } })
      return
    }
    if (event.event === 'error') {
      const payload = event.data as { message?: string }
      emit({ event: 'error', data: { message: payload.message || 'ZPan event stream failed' } })
    }
  })
}

function toTaskSummary(downloader: Downloader, task: ZpanDownloadTask): DownloadTaskSummary {
  return {
    id: task.id,
    downloaderId: downloader.id,
    downloaderName: getDownloaderName(downloader),
    downloaderKind: downloader.kind as DownloaderKind,
    sourceType: task.sourceType,
    sourceUri: task.sourceUri,
    name: task.name || task.sourceUri,
    targetFolder: task.targetFolder || '',
    category: task.category ?? null,
    tags: task.tags ?? [],
    status: task.status as DownloadTaskStatus,
    downloadedBytes: task.downloadedBytes ?? 0,
    storageUploadedBytes: task.storageUploadedBytes ?? 0,
    totalBytes: task.totalBytes ?? null,
    downloadBps: task.downloadBps ?? 0,
    storageUploadBps: task.storageUploadBps ?? 0,
    errorMessage: task.errorMessage ?? null,
  }
}

function getZpanClient(downloader: Downloader) {
  const credentials = readJson<ZpanCredentials>(downloader.credentialsJson)
  return new ZpanClient(downloader.endpoint, credentials.apiKey)
}

function getDownloaderName(downloader: Downloader) {
  return downloader.description || 'ZPan'
}

function readJson<T>(value: string): T {
  return JSON.parse(value) as T
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'unknown error'
}
