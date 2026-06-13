import { zValidator } from '@hono/zod-validator'
import type { Hono } from 'hono'
import { z } from 'zod'
import { createDb } from '../db/client'
import {
  checkDownloaderHealth,
  createDownloader,
  deleteDownloader,
  getDownloader,
  listDownloaders,
  updateDownloader,
} from '../services/downloaders'
import type { AppEnv } from './context'
import { idParamsSchema } from './schemas'

const downloaderSchema = z.object({
  description: z.string().trim().optional(),
  kind: z.enum(['zpan', 'qbittorrent', 'transmission', 'aria2']),
  endpoint: z.string().trim().url(),
  credentials: z.record(z.string(), z.string()),
  options: z.record(z.string(), z.string()),
  enabled: z.boolean(),
})

export function registerDownloaderRoutes(routes: Hono<AppEnv>) {
  routes.get('/downloaders', async (c) => {
    const items = await listDownloaders(createDb(c.env), c.get('user').id)
    return c.json({ items })
  })

  routes.get('/downloaders/:id', zValidator('param', idParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const item = await getDownloader(createDb(c.env), c.get('user').id, id)
    if (!item) return c.json({ error: 'Downloader not found.' }, 404)
    return c.json({ item })
  })

  routes.post('/downloaders', zValidator('json', downloaderSchema), async (c) => {
    const item = await createDownloader(createDb(c.env), c.get('user').id, c.req.valid('json'))
    return c.json({ item }, 201)
  })

  routes.patch(
    '/downloaders/:id',
    zValidator('param', idParamsSchema),
    zValidator('json', downloaderSchema),
    async (c) => {
      const { id } = c.req.valid('param')
      const item = await updateDownloader(createDb(c.env), c.get('user').id, id, c.req.valid('json'))
      if (!item) return c.json({ error: 'Downloader not found.' }, 404)
      return c.json({ item })
    },
  )

  routes.delete('/downloaders/:id', zValidator('param', idParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const deleted = await deleteDownloader(createDb(c.env), c.get('user').id, id)
    if (!deleted) return c.json({ error: 'Downloader not found.' }, 404)
    return c.json({ id })
  })

  routes.post('/downloaders/:id/health', zValidator('param', idParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const health = await checkDownloaderHealth(createDb(c.env), c.get('user').id, id)
    if (!health) return c.json({ error: 'Downloader not found.' }, 404)
    return c.json({ health })
  })
}
