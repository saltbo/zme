import { type Client, createClient } from '@server/clients/zpan/client'
import * as zpanApi from '@server/clients/zpan/sdk.gen'
import type {
  CreateDownloadTaskData,
  DownloadTask,
  DownloadTaskListItem,
  DownloadTaskListPage,
  GetDownloadTaskData,
  ListDownloadTasksData,
} from '@server/clients/zpan/types.gen'
import {
  DownloaderGatewayRateLimitError,
  DownloadSubmissionRejectedError,
  DownloadSubmissionUnknownError,
} from '@server/usecases/ports'

export type ZpanListDownloadTasksParams = NonNullable<ListDownloadTasksData['query']>
export type ZpanDownloadTaskPage = Omit<DownloadTaskListPage, 'nextPageToken'> & { nextPageToken: string | null }
export type ZpanDownloadTaskListItem = DownloadTaskListItem
export type ZpanDownloadTask = DownloadTask
export type ZpanDownloadTaskStatus = ZpanDownloadTask['status']
export type ZpanCreateDownloadTaskInput = CreateDownloadTaskData['body']
export type ZpanGetDownloadTaskPath = GetDownloadTaskData['path']
export type ZpanDownloadTaskEvent =
  | { event: 'resource-change'; data: { resourceType: string; resourceId: string } }
  | { event: 'resync'; data: { sequence: number } }
  | { event: 'heartbeat'; data: { at: string } }
  | { event: 'error'; data: { message: string } }
  | { event: string; data: unknown }

export class ZpanClient {
  private readonly client: Client

  constructor(endpoint: string, apiKey?: string) {
    this.client = createClient({
      baseUrl: endpoint.replace(/\/+$/, ''),
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
    })
  }

  async listDownloadTasks(params: ZpanListDownloadTasksParams, signal?: AbortSignal): Promise<ZpanDownloadTaskPage> {
    const result = await zpanApi.listDownloadTasks({ client: this.client, query: params, signal })
    return expectDownloadTaskPage(await expectData(result, 'ZPan list download tasks failed'))
  }

  async createDownloadTask(input: ZpanCreateDownloadTaskInput, idempotencyKey?: string): Promise<ZpanDownloadTask> {
    let result: Awaited<ReturnType<typeof zpanApi.createDownloadTask>>
    try {
      result = await zpanApi.createDownloadTask({
        client: this.client,
        body: input,
        headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      })
    } catch (error) {
      throw new DownloadSubmissionUnknownError('ZPan create download task outcome is unknown.', { cause: error })
    }
    if (result.data === undefined) {
      const message = getErrorMessage(result.error, 'ZPan create download task failed')
      if (result.response?.status && result.response.status >= 400 && result.response.status < 500) {
        throw new DownloadSubmissionRejectedError(message)
      }
      throw new DownloadSubmissionUnknownError(message)
    }
    try {
      return expectCreatedDownloadTask(result.data)
    } catch (error) {
      throw new DownloadSubmissionUnknownError('ZPan create download task returned an invalid response.', {
        cause: error,
      })
    }
  }

  async getDownloadTask(path: ZpanGetDownloadTaskPath): Promise<ZpanDownloadTask | null> {
    const result = await zpanApi.getDownloadTask({ client: this.client, path })
    if (result.response?.status === 404) return null
    return expectDownloadTask(await expectData(result, 'ZPan get download task failed'))
  }

  async streamDownloadTaskEvents(
    signal: AbortSignal,
    onEvent: (event: ZpanDownloadTaskEvent) => void | Promise<void>,
  ): Promise<void> {
    let streamError: unknown
    const pendingEvents: ZpanDownloadTaskEvent[] = []
    const result = await zpanApi.streamEvents({
      client: this.client,
      signal,
      sseMaxRetryAttempts: 1,
      onSseError: (error) => {
        streamError = error
      },
      onSseEvent: (event) => {
        pendingEvents.push(expectDownloadTaskEvent(event.event || 'message', event.data))
      },
    })

    let next = await result.stream.next(false)
    while (!next.done) {
      await flushPendingEvents(pendingEvents, onEvent)
      next = await result.stream.next(false)
    }
    await flushPendingEvents(pendingEvents, onEvent)

    if (streamError && !signal.aborted) {
      throw new Error(getErrorMessage(streamError, 'ZPan download task events failed'))
    }
  }
}

function expectDownloadTaskPage(value: unknown): ZpanDownloadTaskPage {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('items' in value) ||
    !Array.isArray(value.items) ||
    !value.items.every(isDownloadTaskListItem) ||
    !('nextPageToken' in value) ||
    (value.nextPageToken !== null && typeof value.nextPageToken !== 'string')
  ) {
    throw new Error('ZPan list download tasks returned an invalid response')
  }
  return value as ZpanDownloadTaskPage
}

function expectCreatedDownloadTask(value: unknown): ZpanDownloadTask {
  if (!isRecord(value) || typeof value.id !== 'string') {
    throw new Error('ZPan create download task returned an invalid response')
  }
  return value as ZpanDownloadTask
}

function expectDownloadTask(value: unknown): ZpanDownloadTask {
  if (!isDownloadTaskListItem(value) || !hasExactTaskStatus(value.status)) {
    throw new Error('ZPan get download task returned an invalid response')
  }
  return value as ZpanDownloadTask
}

function hasExactTaskStatus(status: Record<string, unknown>) {
  return (
    'error' in status &&
    (status.error === null || (isRecord(status.error) && typeof status.error.message === 'string')) &&
    'output' in status &&
    (status.output === null || (isRecord(status.output) && typeof status.output.objectId === 'string')) &&
    typeof status.updatedAt === 'string'
  )
}

function expectDownloadTaskEvent(event: string, data: unknown): ZpanDownloadTaskEvent {
  if (event === 'resource-change') {
    if (!isRecord(data) || typeof data.resourceType !== 'string' || typeof data.resourceId !== 'string') {
      throw invalidEvent(event)
    }
    return { event, data: { resourceType: data.resourceType, resourceId: data.resourceId } }
  }
  if (event === 'resync') {
    if (!isRecord(data) || typeof data.sequence !== 'number') throw invalidEvent(event)
    return { event, data: { sequence: data.sequence } }
  }
  if (event === 'heartbeat') {
    if (!isRecord(data) || typeof data.at !== 'string') throw invalidEvent(event)
    return { event, data: { at: data.at } }
  }
  if (event === 'error') {
    if (!isRecord(data) || typeof data.message !== 'string') throw invalidEvent(event)
    return { event, data: { message: data.message } }
  }
  return { event, data }
}

function invalidEvent(event: string) {
  return new Error(`ZPan ${event} event returned an invalid payload`)
}

function isDownloadTaskListItem(value: unknown): value is ZpanDownloadTaskListItem {
  if (!isRecord(value) || typeof value.id !== 'string' || !isRecord(value.spec) || !isRecord(value.status)) return false
  const { source, destination, labels } = value.spec
  const { progress, runtime } = value.status
  return (
    isRecord(source) &&
    (source.type === 'http' || source.type === 'magnet' || source.type === 'torrent_url') &&
    typeof source.uri === 'string' &&
    isRecord(destination) &&
    typeof destination.folder === 'string' &&
    (destination.name === undefined || destination.name === null || typeof destination.name === 'string') &&
    isRecord(labels) &&
    (labels.category === undefined || labels.category === null || typeof labels.category === 'string') &&
    Array.isArray(labels.tags) &&
    labels.tags.every((tag) => typeof tag === 'string') &&
    isDownloadTaskState(value.status.state) &&
    isProgress(progress) &&
    (runtime === undefined || runtime === null || (isRecord(runtime) && isRuntime(runtime)))
  )
}

function isDownloadTaskState(value: unknown): value is ZpanDownloadTask['status']['state'] {
  return (
    value === 'queued' ||
    value === 'assigned' ||
    value === 'downloading' ||
    value === 'suspended' ||
    value === 'pausing' ||
    value === 'paused' ||
    value === 'interrupted' ||
    value === 'uploading' ||
    value === 'canceling' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'canceled'
  )
}

function isProgress(value: unknown) {
  return isRecord(value) && isTransferProgress(value.download) && isTransferProgress(value.upload)
}

function isTransferProgress(value: unknown) {
  if (!isRecord(value)) return false
  const hasValidTotalBytes =
    value.totalBytes === undefined || value.totalBytes === null || typeof value.totalBytes === 'number'
  return typeof value.bytes === 'number' && typeof value.bytesPerSecond === 'number' && hasValidTotalBytes
}

function isRuntime(value: Record<string, unknown>) {
  return (
    (value.progress === undefined || isProgress(value.progress)) &&
    (value.torrent === undefined ||
      (isRecord(value.torrent) && (value.torrent.name === undefined || typeof value.torrent.name === 'string'))) &&
    (value.updatedAt === undefined || typeof value.updatedAt === 'string')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function flushPendingEvents(
  pendingEvents: ZpanDownloadTaskEvent[],
  onEvent: (event: ZpanDownloadTaskEvent) => void | Promise<void>,
) {
  for (const event of pendingEvents.splice(0)) {
    await onEvent(event)
  }
}

async function expectData<T>(
  result: { data?: T; error?: unknown; response?: Response },
  fallbackMessage: string,
): Promise<T> {
  if (result.data !== undefined) return result.data
  const message = getErrorMessage(result.error, fallbackMessage)
  if (result.response?.status === 429) {
    throw new DownloaderGatewayRateLimitError(message, retryAfterMilliseconds(result.response), {
      cause: result.error,
    })
  }
  throw new Error(message, { cause: result.error })
}

function retryAfterMilliseconds(response: Response): number {
  const value = response.headers.get('Retry-After')?.trim()
  if (!value) return 0
  if (/^\d+$/.test(value)) return Number(value) * 1_000
  const retryAt = Date.parse(value)
  return Number.isNaN(retryAt) ? 0 : Math.max(0, retryAt - Date.now())
}

function getErrorMessage(error: unknown, fallbackMessage: string) {
  if (typeof error === 'string') return `${fallbackMessage}: ${error}`
  if (error instanceof Error) return `${fallbackMessage}: ${error.message}`
  const apiMessage = getApiErrorMessage(error)
  if (apiMessage) return `${fallbackMessage}: ${apiMessage}`
  return fallbackMessage
}

// ZPan wraps failures as `{ error: { code, message, status, details } }`.
function getApiErrorMessage(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('error' in value)) return null
  const { error } = value as { error: unknown }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error as { message: unknown }
    if (typeof message === 'string') return message
  }
  return null
}
