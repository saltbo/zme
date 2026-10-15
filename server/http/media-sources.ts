import { zValidator } from '@hono/zod-validator'
import {
  checkMediaSourceHealth,
  createMediaSource,
  deleteMediaSource,
  getMediaSource,
  listMediaSources,
  updateMediaSource,
} from '@server/usecases/media-sources'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from './context'
import { requireMergePatch } from './protocol'
import { idParamsSchema } from './schemas'

const mediaSourceSchema = z.object({
  description: z.string().trim().optional(),
  kind: z.enum(['tmdb']),
  credentials: z.record(z.string(), z.string()),
  options: z.record(z.string(), z.string()),
  enabled: z.boolean(),
})
const mediaSourcePatchSchema = mediaSourceSchema
  .partial()
  .extend({
    description: z.string().trim().nullable().optional(),
    credentials: z.record(z.string(), z.string().nullable()).nullable().optional(),
    options: z.record(z.string(), z.string().nullable()).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0)
export function registerMediaSourceRoutes(routes: Hono<AppEnv>) {
  routes.get('/media-sources', async (c) => {
    const items = await listMediaSources(c.get('deps'))
    return c.json({ items })
  })

  routes.get('/media-sources/:id', zValidator('param', idParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const item = await getMediaSource(c.get('deps'), id)
    if (!item) return c.json({ error: 'Media source not found.' }, 404)
    return c.json(item)
  })

  routes.post('/media-sources', zValidator('json', mediaSourceSchema), async (c) => {
    const item = await createMediaSource(c.get('deps'), c.req.valid('json'))
    c.header('Location', `/api/media-sources/${item.id}`)
    return c.json(item, 201)
  })

  routes.patch(
    '/media-sources/:id',
    zValidator('param', idParamsSchema),
    zValidator('json', mediaSourcePatchSchema),
    async (c) => {
      const unsupported = requireMergePatch(c)
      if (unsupported) return unsupported
      const { id } = c.req.valid('param')
      const item = await updateMediaSource(c.get('deps'), id, c.req.valid('json'))
      if (!item) return c.json({ error: 'Media source not found.' }, 404)
      return c.json(item)
    },
  )

  routes.delete('/media-sources/:id', zValidator('param', idParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const deleted = await deleteMediaSource(c.get('deps'), id)
    if (!deleted) return c.json({ error: 'Media source not found.' }, 404)
    return c.body(null, 204)
  })

  routes.get('/media-sources/:id/health', zValidator('param', idParamsSchema), async (c) => {
    const health = await checkMediaSourceHealth(c.get('deps'), c.req.valid('param').id)
    if (!health) return c.json({ error: 'Connection not found.' }, 404)
    c.header('Cache-Control', 'private, no-store')
    return c.json(health)
  })
}
