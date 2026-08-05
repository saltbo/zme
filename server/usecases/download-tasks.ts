import type { DownloadTaskPage, DownloadTaskSummary } from '@shared/types'
import type { Deps } from './deps'
import type {
  DownloaderRecord,
  DownloadTaskEvent,
  DownloadTaskGateway,
  DownloadTaskOwner,
  ListDownloadTasksInput,
} from './ports'
import { DownloaderGatewayRateLimitError } from './ports'

const heartbeatIntervalMs = 15_000
const initialRetryDelayMs = 1_000
const maxRetryDelayMs = 30_000

type StreamOptions = {
  heartbeatIntervalMs?: number
  initialRetryDelayMs?: number
  maxRetryDelayMs?: number
}

export type { DownloadTaskEvent, ListDownloadTasksInput }

export async function listDownloadTasks(
  deps: Deps,
  userId: string,
  input: ListDownloadTasksInput,
  signal?: AbortSignal,
): Promise<DownloadTaskPage> {
  const rows = await listTaskCapableDownloaders(deps, userId)

  const results = await Promise.all(
    rows.map(({ downloader, gateway }) => gateway.list(downloader.config, toOwner(downloader), input, signal)),
  )
  return {
    items: results.flatMap((result) => result.items),
    total: results.reduce((sum, result) => sum + result.total, 0),
    page: input.page,
    pageSize: input.pageSize,
  }
}

/**
 * Streams merged download-task events from every task-capable downloader.
 * Emits a fresh full snapshot whenever any downloader reports one, and
 * keeps each upstream connected until `signal` aborts.
 */
export async function streamDownloadTaskEvents(
  deps: Deps,
  userId: string,
  signal: AbortSignal,
  emit: (event: DownloadTaskEvent) => void,
  options: StreamOptions = {},
): Promise<void> {
  const rows = await listTaskCapableDownloaders(deps, userId)
  const latestByDownloader = new Map<string, DownloadTaskSummary[]>()
  const sendSnapshot = (downloaderId: string, items: DownloadTaskSummary[]) => {
    const current = latestByDownloader.get(downloaderId)
    if (current && JSON.stringify(current) === JSON.stringify(items)) return
    latestByDownloader.set(downloaderId, items)
    emit({ event: 'snapshot', data: { items: [...latestByDownloader.values()].flat() } })
  }

  const aborter = new AbortController()
  const abort = () => aborter.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) aborter.abort()

  try {
    if (rows.length === 0) emit({ event: 'snapshot', data: { items: [] } })
    await Promise.all([
      ...rows.map(({ downloader, gateway }) =>
        superviseDownloaderStream(
          downloader,
          gateway,
          aborter.signal,
          (event) => {
            if (event.event === 'snapshot') {
              sendSnapshot(downloader.id, event.data.items)
              return
            }
            emit({
              event: 'upstream-error',
              data: {
                downloaderId: downloader.id,
                downloaderName: getDownloaderName(downloader),
                message: `${getDownloaderName(downloader)}: ${event.data.message}`,
              },
            })
          },
          emit,
          options,
        ),
      ),
      sendHeartbeats(aborter.signal, emit, options.heartbeatIntervalMs ?? heartbeatIntervalMs),
    ])
  } finally {
    signal.removeEventListener('abort', abort)
    aborter.abort()
  }
}

async function superviseDownloaderStream(
  downloader: DownloaderRecord,
  gateway: DownloadTaskGateway,
  signal: AbortSignal,
  onEvent: Parameters<DownloadTaskGateway['stream']>[3],
  emit: (event: DownloadTaskEvent) => void,
  options: StreamOptions,
) {
  let retryDelay = options.initialRetryDelayMs ?? initialRetryDelayMs
  const maximumRetryDelay = options.maxRetryDelayMs ?? maxRetryDelayMs
  let failureReported = false

  while (!signal.aborted) {
    let failure: unknown
    try {
      await gateway.stream(downloader.config, toOwner(downloader), signal, onEvent)
      if (signal.aborted) return
      failure = new Error('upstream event stream ended')
    } catch (error) {
      if (signal.aborted) return
      failure = error
    }

    const attemptRetryDelay =
      failure instanceof DownloaderGatewayRateLimitError ? Math.max(retryDelay, failure.retryAfterMs) : retryDelay
    if (!failureReported) {
      const downloaderName = getDownloaderName(downloader)
      emit({
        event: 'upstream-error',
        data: {
          downloaderId: downloader.id,
          downloaderName,
          message: `${downloaderName}: ${getErrorMessage(failure)}`,
          retryingInMs: attemptRetryDelay,
        },
      })
      failureReported = true
    }

    await delay(attemptRetryDelay, signal)
    retryDelay = Math.min(retryDelay * 2, maximumRetryDelay)
  }
}

async function sendHeartbeats(signal: AbortSignal, emit: (event: DownloadTaskEvent) => void, intervalMs: number) {
  while (!signal.aborted) {
    await delay(intervalMs, signal)
    if (!signal.aborted) emit({ event: 'heartbeat', data: { at: new Date().toISOString() } })
  }
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    const abort = () => {
      clearTimeout(timer)
      done()
    }
    function done() {
      signal.removeEventListener('abort', abort)
      resolve()
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

async function listTaskCapableDownloaders(
  deps: Deps,
  userId: string,
): Promise<Array<{ downloader: DownloaderRecord; gateway: DownloadTaskGateway }>> {
  const records = await deps.downloadersRepo.listEnabled(userId)

  return records.flatMap((downloader) => {
    const gateway = deps.downloadTaskGateways[downloader.kind]
    return gateway ? [{ downloader, gateway }] : []
  })
}

function toOwner(downloader: DownloaderRecord): DownloadTaskOwner {
  return {
    downloaderId: downloader.id,
    downloaderName: getDownloaderName(downloader),
    downloaderKind: downloader.kind,
  }
}

function getDownloaderName(downloader: DownloaderRecord) {
  return downloader.description || 'ZPan'
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'unknown error'
}
