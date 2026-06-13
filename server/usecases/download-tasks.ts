import type { DownloadTaskPage, DownloadTaskSummary } from '@shared/types'
import type { Deps } from './deps'
import type {
  DownloaderRecord,
  DownloadTaskEvent,
  DownloadTaskGateway,
  DownloadTaskOwner,
  ListDownloadTasksInput,
} from './ports'

export type { DownloadTaskEvent, ListDownloadTasksInput }

export async function listDownloadTasks(
  deps: Deps,
  userId: string,
  input: ListDownloadTasksInput,
): Promise<DownloadTaskPage> {
  const rows = await listTaskCapableDownloaders(deps, userId)

  const results = await Promise.all(
    rows.map(({ downloader, gateway }) => gateway.list(downloader.config, toOwner(downloader), input)),
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
 * resolves once all upstream streams have ended or `signal` aborts.
 */
export async function streamDownloadTaskEvents(
  deps: Deps,
  userId: string,
  signal: AbortSignal,
  emit: (event: DownloadTaskEvent) => void,
): Promise<void> {
  const rows = await listTaskCapableDownloaders(deps, userId)
  const latestByDownloader = new Map<string, DownloadTaskSummary[]>()
  const sendSnapshot = () => {
    emit({ event: 'snapshot', data: { items: [...latestByDownloader.values()].flat() } })
  }

  if (rows.length === 0) {
    sendSnapshot()
    return
  }

  const aborter = new AbortController()
  const abort = () => aborter.abort()
  signal.addEventListener('abort', abort, { once: true })

  try {
    await Promise.all(
      rows.map(({ downloader, gateway }) =>
        gateway
          .stream(downloader.config, toOwner(downloader), aborter.signal, (event) => {
            if (event.event === 'snapshot') {
              latestByDownloader.set(downloader.id, event.data.items)
              sendSnapshot()
              return
            }
            emit({ event: 'error', data: { message: `${getDownloaderName(downloader)}: ${event.data.message}` } })
          })
          .catch((error) => {
            if (!aborter.signal.aborted) {
              emit({ event: 'error', data: { message: `${getDownloaderName(downloader)}: ${getErrorMessage(error)}` } })
            }
          }),
      ),
    )
  } finally {
    signal.removeEventListener('abort', abort)
    aborter.abort()
  }
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
