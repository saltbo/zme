import { zValidator } from '@hono/zod-validator'
import {
  checkDownloaderHealth,
  createDownloader,
  deleteDownloader,
  getDownloader,
  getDownloaderHealth,
  listDownloaders,
  updateDownloader,
} from '@server/usecases/downloaders'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from './context'
import { entityTag, ifMatchRevision, problem, requireMergePatch } from './protocol'
import { idParamsSchema } from './schemas'

const downloaderSchema = z.object({
  description: z.string().trim().optional(),
  kind: z.enum(['zpan', 'qbittorrent', 'transmission', 'aria2']),
  endpoint: z.string().trim().url(),
  credentials: z.record(z.string(), z.string()),
  options: z.record(z.string(), z.string()),
  enabled: z.boolean(),
})
const downloaderPatchSchema = downloaderSchema.partial().refine((value) => Object.keys(value).length > 0)
export function registerDownloaderRoutes(routes: Hono<AppEnv>) {
  routes.get('/downloaders', async (c) => {
    const items = await listDownloaders(c.get('deps'), c.get('user').id)
    return c.json({ items })
  })

  routes.get('/downloaders/:id', zValidator('param', idParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const item = await getDownloader(c.get('deps'), c.get('user').id, id)
    if (!item) return c.json({ error: 'Downloader not found.' }, 404)
    c.header('ETag', entityTag(item.updatedAt))
    return c.json({ item })
  })

  routes.post('/downloaders', zValidator('json', downloaderSchema), async (c) => {
    const item = await createDownloader(c.get('deps'), c.get('user').id, c.req.valid('json'))
    c.header('Location', `/api/downloaders/${item.id}`)
    c.header('ETag', entityTag(item.updatedAt))
    return c.json({ item }, 201)
  })

  routes.patch(
    '/downloaders/:id',
    zValidator('param', idParamsSchema),
    zValidator('json', downloaderPatchSchema),
    async (c) => {
      const unsupported = requireMergePatch(c)
      if (unsupported) return unsupported
      const { id } = c.req.valid('param')
      const expectedUpdatedAt = ifMatchRevision(c)
      if (!expectedUpdatedAt) return problem(c, 428, 'precondition-required', 'If-Match is required')
      const item = await updateDownloader(c.get('deps'), c.get('user').id, id, c.req.valid('json'), expectedUpdatedAt)
      if (!item) return c.json({ error: 'Downloader not found.' }, 404)
      c.header('ETag', entityTag(item.updatedAt))
      return c.json({ item })
    },
  )

  routes.delete('/downloaders/:id', zValidator('param', idParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const expectedUpdatedAt = ifMatchRevision(c)
    if (!expectedUpdatedAt) return problem(c, 428, 'precondition-required', 'If-Match is required')
    const deleted = await deleteDownloader(c.get('deps'), c.get('user').id, id, expectedUpdatedAt)
    if (!deleted) return c.json({ error: 'Downloader not found.' }, 404)
    return c.body(null, 204)
  })

  routes.post('/downloaders/:id/health-observations', zValidator('param', idParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const health = await checkDownloaderHealth(c.get('deps'), c.get('user').id, id)
    if (!health) return c.json({ error: 'Downloader not found.' }, 404)
    c.header('Location', `/api/downloaders/${id}/health-observations/${encodeURIComponent(health.checkedAt as string)}`)
    return c.json({ item: health }, 201)
  })

  routes.get('/downloaders/:id/health-observations', zValidator('param', idParamsSchema), async (c) => {
    const health = await getDownloaderHealth(c.get('deps'), c.get('user').id, c.req.valid('param').id)
    if (!health) return c.json({ error: 'Downloader not found.' }, 404)
    return c.json({ items: health.checkedAt ? [health] : [] })
  })

  routes.get('/downloaders/:id/health-observations/:checkedAt', zValidator('param', idParamsSchema), async (c) => {
    const health = await getDownloaderHealth(c.get('deps'), c.get('user').id, c.req.param('id'))
    if (!health || health.checkedAt !== c.req.param('checkedAt'))
      return c.json({ error: 'Health observation not found.' }, 404)
    return c.json({ item: health })
  })
}
