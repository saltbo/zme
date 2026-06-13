import type { DownloadTaskPage, DownloadTaskSummary } from '@shared/types'
import { and, eq } from 'drizzle-orm'
import { downloadTaskGateways } from '../adapters/gateways/downloaders'
import type { createDb } from '../db/client'
import { type Downloader, downloaders } from '../db/schema'
import type { DownloadTaskEvent, DownloadTaskGateway, DownloadTaskOwner, ListDownloadTasksInput } from '../usecases/ports'
import { toConnectorConfig } from './connectors'

type Db = ReturnType<typeof createDb>

export type { ListDownloadTasksInput }

export async function listDownloadTasks(
  db: Db,
  userId: string,
  input: ListDownloadTasksInput,
): Promise<DownloadTaskPage> {
  const rows = await listEnabledDownloaders(db, userId)

  const results = await Promise.all(
    rows.map(({ downloader, gateway }) =>
      gateway.list(toConnectorConfig(downloader), toOwner(downloader), input),
    ),
  )
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

      for (const { downloader, gateway } of rows) {
        void gateway
          .stream(toConnectorConfig(downloader), toOwner(downloader), abortController.signal, (event) => {
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

async function listEnabledDownloaders(
  db: Db,
  userId: string,
): Promise<Array<{ downloader: Downloader; gateway: DownloadTaskGateway }>> {
  const rows = await db
    .select()
    .from(downloaders)
    .where(and(eq(downloaders.userId, userId), eq(downloaders.enabled, true)))

  return rows.flatMap((downloader) => {
    const gateway = downloadTaskGateways[downloader.kind]
    return gateway ? [{ downloader, gateway }] : []
  })
}

function toOwner(downloader: Downloader): DownloadTaskOwner {
  return {
    downloaderId: downloader.id,
    downloaderName: getDownloaderName(downloader),
    downloaderKind: downloader.kind,
  }
}

function getDownloaderName(downloader: Downloader) {
  return downloader.description || 'ZPan'
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'unknown error'
}
