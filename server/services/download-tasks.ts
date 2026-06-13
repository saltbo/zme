import type { DownloadTaskPage, DownloadTaskSummary } from '@shared/types'
import { downloadTaskGateways } from '../adapters/gateways/downloaders'
import { createDownloadersRepo } from '../adapters/repos/downloaders'
import type { createDb } from '../db/client'
import type {
  DownloaderRecord,
  DownloadTaskEvent,
  DownloadTaskGateway,
  DownloadTaskOwner,
  ListDownloadTasksInput,
} from '../usecases/ports'

type Db = ReturnType<typeof createDb>

export type { ListDownloadTasksInput }

export async function listDownloadTasks(
  db: Db,
  userId: string,
  input: ListDownloadTasksInput,
): Promise<DownloadTaskPage> {
  const rows = await listTaskCapableDownloaders(db, userId)

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

export async function streamDownloadTaskEvents(db: Db, userId: string, signal: AbortSignal): Promise<Response> {
  const rows = await listTaskCapableDownloaders(db, userId)
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

      for (const { downloader, gateway } of rows) {
        void gateway
          .stream(downloader.config, toOwner(downloader), abortController.signal, (event) => {
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

async function listTaskCapableDownloaders(
  db: Db,
  userId: string,
): Promise<Array<{ downloader: DownloaderRecord; gateway: DownloadTaskGateway }>> {
  const records = await createDownloadersRepo(db).listEnabled(userId)

  return records.flatMap((downloader) => {
    const gateway = downloadTaskGateways[downloader.kind]
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
