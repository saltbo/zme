import { zValidator } from '@hono/zod-validator'
import { type DownloadTaskEvent, listDownloadTasks, streamDownloadTaskEvents } from '@server/usecases/download-tasks'
import { submitDownload } from '@server/usecases/downloaders'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from './context'

const createDownloadSchema = z.object({
  downloaderId: z.string().trim().min(1),
  uri: z.string().trim().min(1),
  sourceType: z.enum(['magnet', 'torrent_url']),
  title: z.string().trim().optional(),
  category: z.string().trim().min(1).max(120).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
})

const downloadsQuerySchema = z.object({
  status: z
    .enum([
      'queued',
      'assigned',
      'running',
      'billing_paused',
      'pausing',
      'paused',
      'uploading',
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
  routes.get('/downloads', zValidator('query', downloadsQuerySchema), async (c) => {
    const result = await listDownloadTasks(c.get('deps'), c.get('user').id, c.req.valid('query'))
    return c.json(result)
  })

  routes.get('/downloads/events', (c) => {
    const deps = c.get('deps')
    const userId = c.get('user').id
    // Owns stream teardown: aborts upstream downloader streams both when the
    // request is aborted and when the response body consumer cancels.
    const aborter = new AbortController()
    c.req.raw.signal.addEventListener('abort', () => aborter.abort(), { once: true })
    const encoder = new TextEncoder()
    let closed = false

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: DownloadTaskEvent) => {
          if (closed) return
          controller.enqueue(encoder.encode(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`))
        }

        streamDownloadTaskEvents(deps, userId, aborter.signal, send)
          .catch((error) => {
            send({
              event: 'error',
              data: { message: error instanceof Error ? error.message : 'Download task stream failed.' },
            })
          })
          .finally(() => {
            if (closed) return
            closed = true
            controller.close()
          })
      },
      cancel() {
        closed = true
        aborter.abort()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  })

  routes.post('/downloads', zValidator('json', createDownloadSchema), async (c) => {
    try {
      const item = await submitDownload(c.get('deps'), c.get('user').id, c.req.valid('json'))
      return c.json({ item }, 201)
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Download submission failed.' }, 502)
    }
  })
}
