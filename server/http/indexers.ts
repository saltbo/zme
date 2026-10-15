import { zValidator } from '@hono/zod-validator'
import {
  checkIndexerHealth,
  createIndexer,
  deleteIndexer,
  getIndexer,
  listIndexers,
  updateIndexer,
} from '@server/usecases/indexers'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from './context'
import { requireMergePatch } from './protocol'
import { idParamsSchema } from './schemas'

const indexerSchema = z.object({
  description: z.string().trim().optional(),
  kind: z.enum(['prowlarr']),
  endpoint: z.string().trim().url(),
  credentials: z.record(z.string(), z.string()),
  options: z.record(z.string(), z.string()),
  enabled: z.boolean(),
})
const indexerPatchSchema = indexerSchema
  .partial()
  .extend({
    description: z.string().trim().nullable().optional(),
    credentials: z.record(z.string(), z.string().nullable()).nullable().optional(),
    options: z.record(z.string(), z.string().nullable()).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0)
export function registerIndexerRoutes(routes: Hono<AppEnv>) {
  routes.get('/indexers', async (c) => {
    const items = await listIndexers(c.get('deps'))
    return c.json({ items })
  })

  routes.get('/indexers/:id', zValidator('param', idParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const item = await getIndexer(c.get('deps'), id)
    if (!item) return c.json({ error: 'Indexer not found.' }, 404)
    return c.json(item)
  })

  routes.post('/indexers', zValidator('json', indexerSchema), async (c) => {
    const item = await createIndexer(c.get('deps'), c.req.valid('json'))
    c.header('Location', `/api/indexers/${item.id}`)
    return c.json(item, 201)
  })

  routes.patch(
    '/indexers/:id',
    zValidator('param', idParamsSchema),
    zValidator('json', indexerPatchSchema),
    async (c) => {
      const unsupported = requireMergePatch(c)
      if (unsupported) return unsupported
      const { id } = c.req.valid('param')
      const item = await updateIndexer(c.get('deps'), id, c.req.valid('json'))
      if (!item) return c.json({ error: 'Indexer not found.' }, 404)
      return c.json(item)
    },
  )

  routes.delete('/indexers/:id', zValidator('param', idParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const deleted = await deleteIndexer(c.get('deps'), id)
    if (!deleted) return c.json({ error: 'Indexer not found.' }, 404)
    return c.body(null, 204)
  })

  routes.get('/indexers/:id/health', zValidator('param', idParamsSchema), async (c) => {
    const health = await checkIndexerHealth(c.get('deps'), c.req.valid('param').id)
    if (!health) return c.json({ error: 'Connection not found.' }, 404)
    c.header('Cache-Control', 'private, no-store')
    return c.json(health)
  })
}
