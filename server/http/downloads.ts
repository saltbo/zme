import { zValidator } from '@hono/zod-validator'
import type { Hono } from 'hono'
import { z } from 'zod'
import { createDb } from '../db/client'
import { listDownloadTasks, streamDownloadTaskEvents } from '../services/download-tasks'
import { submitDownload } from '../services/downloaders'
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
    const result = await listDownloadTasks(createDb(c.env), c.get('user').id, c.req.valid('query'))
    return c.json(result)
  })

  routes.get('/downloads/events', async (c) => {
    return streamDownloadTaskEvents(createDb(c.env), c.get('user').id, c.req.raw.signal)
  })

  routes.post('/downloads', zValidator('json', createDownloadSchema), async (c) => {
    try {
      const item = await submitDownload(createDb(c.env), c.get('user').id, c.req.valid('json'))
      return c.json({ item }, 201)
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Download submission failed.' }, 502)
    }
  })
}
