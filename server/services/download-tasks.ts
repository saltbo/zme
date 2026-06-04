import type { DownloaderKind, DownloadTaskPage, DownloadTaskStatus, DownloadTaskSummary } from '@shared/types'
import { and, eq } from 'drizzle-orm'
import type { createDb } from '../db/client'
import { type Downloader, downloaders } from '../db/schema'

type Db = ReturnType<typeof createDb>
type DownloadTaskSnapshot = { items: DownloadTaskSummary[] }
type DownloadTaskEvent =
  | { event: 'snapshot'; data: DownloadTaskSnapshot }
  | { event: 'error'; data: { message: string } }

interface ZpanCredentials {
  apiKey?: string
}

interface ZpanTask {
  id: string
  sourceType: 'http' | 'magnet' | 'torrent_url'
  sourceUri: string
  name?: string | null
  targetFolder?: string | null
  category?: string | null
  tags?: string[]
  status: DownloadTaskStatus
  downloadedBytes?: number
  storageUploadedBytes?: number
  totalBytes?: number | null
  downloadBps?: number
  storageUploadBps?: number
  errorMessage?: string | null
  createdAt?: string
  updatedAt?: string
  startedAt?: string | null
  finishedAt?: string | null
}

interface ZpanTaskPage {
  items?: ZpanTask[]
  total?: number
  page?: number
  pageSize?: number
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
  const credentials = readJson<ZpanCredentials>(downloader.credentialsJson)
  const url = new URL('/api/download-tasks', normalizeBaseUrl(downloader.endpoint))
  url.searchParams.set('page', String(input.page))
  url.searchParams.set('pageSize', String(input.pageSize))
  if (input.status) url.searchParams.set('status', input.status)

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(credentials.apiKey ? { authorization: `Bearer ${credentials.apiKey}` } : {}),
    },
  })
  await assertOk(response, 'ZPan')

  const payload = (await response.json()) as ZpanTaskPage
  return {
    items: (payload.items ?? []).map((task) => toTaskSummary(downloader, task)),
    total: payload.total ?? payload.items?.length ?? 0,
    page: payload.page ?? input.page,
    pageSize: payload.pageSize ?? input.pageSize,
  }
}

async function streamZpanTasks(
  downloader: Downloader,
  signal: AbortSignal,
  emit: (event: DownloadTaskEvent) => void,
): Promise<void> {
  const credentials = readJson<ZpanCredentials>(downloader.credentialsJson)
  const url = new URL('/api/download-tasks/events', normalizeBaseUrl(downloader.endpoint))
  const response = await fetch(url, {
    headers: {
      Accept: 'text/event-stream',
      ...(credentials.apiKey ? { authorization: `Bearer ${credentials.apiKey}` } : {}),
    },
    signal,
  })
  await assertOk(response, 'ZPan')
  if (!response.body) throw new Error('ZPan event stream is empty')

  await readServerSentEvents(response.body, (event) => {
    if (event.event === 'snapshot') {
      const payload = JSON.parse(event.data) as ZpanTaskPage
      emit({ event: 'snapshot', data: { items: (payload.items ?? []).map((task) => toTaskSummary(downloader, task)) } })
      return
    }
    if (event.event === 'error') {
      const payload = JSON.parse(event.data) as { message?: string }
      emit({ event: 'error', data: { message: payload.message || 'ZPan event stream failed' } })
    }
  })
}

function toTaskSummary(downloader: Downloader, task: ZpanTask): DownloadTaskSummary {
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
    status: task.status,
    downloadedBytes: task.downloadedBytes ?? 0,
    storageUploadedBytes: task.storageUploadedBytes ?? 0,
    totalBytes: task.totalBytes ?? null,
    downloadBps: task.downloadBps ?? 0,
    storageUploadBps: task.storageUploadBps ?? 0,
    errorMessage: task.errorMessage ?? null,
    createdAt: task.createdAt ?? new Date(0).toISOString(),
    updatedAt: task.updatedAt ?? new Date(0).toISOString(),
    startedAt: task.startedAt ?? null,
    finishedAt: task.finishedAt ?? null,
  }
}

function getDownloaderName(downloader: Downloader) {
  return downloader.description || 'ZPan'
}

function readJson<T>(value: string): T {
  return JSON.parse(value) as T
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

async function assertOk(response: Response, target: string) {
  if (response.ok) return
  const text = await response.text()
  throw new Error(`${target} request failed: ${response.status}${text ? ` ${text}` : ''}`)
}

async function readServerSentEvents(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: { event: string; data: string }) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split(/\r?\n\r?\n/)
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const event = parseServerSentEvent(part)
      if (event) onEvent(event)
    }
  }

  buffer += decoder.decode()
  const event = parseServerSentEvent(buffer)
  if (event) onEvent(event)
}

function parseServerSentEvent(block: string): { event: string; data: string } | null {
  let event = 'message'
  const data: string[] = []

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim()
    if (line.startsWith('data:')) data.push(line.slice('data:'.length).trimStart())
  }

  if (data.length === 0) return null
  return { event, data: data.join('\n') }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'unknown error'
}
