import { zValidator } from '@hono/zod-validator'
import {
  checkIndexerHealth,
  createIndexer,
  deleteIndexer,
  getIndexer,
  getIndexerHealth,
  listIndexers,
  searchIndexers,
  updateIndexer,
} from '@server/usecases/indexers'
import { IndexerNotConfiguredError, IndexerSearchError } from '@server/usecases/ports'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from './context'
import { entityTag, ifMatchRevision, problem, requireMergePatch } from './protocol'
import { idParamsSchema } from './schemas'

const indexerSearchQuerySchema = z.object({
  q: z.string().trim().min(1),
  searchType: z.enum(['search', 'audiosearch', 'booksearch']).optional(),
  categories: z.string().trim().optional(),
})

const indexerSchema = z.object({
  description: z.string().trim().optional(),
  kind: z.enum(['prowlarr']),
  endpoint: z.string().trim().url(),
  credentials: z.record(z.string(), z.string()),
  options: z.record(z.string(), z.string()),
  enabled: z.boolean(),
})
const indexerPatchSchema = indexerSchema.partial().refine((value) => Object.keys(value).length > 0)
export function registerIndexerRoutes(routes: Hono<AppEnv>) {
  routes.get('/release-candidates', zValidator('query', indexerSearchQuerySchema), async (c) => {
    const { q, searchType, categories } = c.req.valid('query')
    try {
      const deps = c.get('deps')
      const results = await searchIndexers(deps, {
        query: q,
        searchType,
        categories: parseNumberList(categories),
      })
      return c.json({ results })
    } catch (error) {
      if (error instanceof IndexerNotConfiguredError) {
        return c.json({ code: 'INDEXER_NOT_CONFIGURED', error: error.message }, 503)
      }
      if (error instanceof IndexerSearchError) {
        return c.json({ code: 'INDEXER_SEARCH_FAILED', error: error.message }, 502)
      }
      throw error
    }
  })

  routes.get('/indexers', async (c) => {
    const items = await listIndexers(c.get('deps'))
    return c.json({ items })
  })

  routes.get('/indexers/:id', zValidator('param', idParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const item = await getIndexer(c.get('deps'), id)
    if (!item) return c.json({ error: 'Indexer not found.' }, 404)
    c.header('ETag', entityTag(item.updatedAt))
    return c.json({ item })
  })

  routes.post('/indexers', zValidator('json', indexerSchema), async (c) => {
    const item = await createIndexer(c.get('deps'), c.req.valid('json'))
    c.header('Location', `/api/indexers/${item.id}`)
    c.header('ETag', entityTag(item.updatedAt))
    return c.json({ item }, 201)
  })

  routes.patch(
    '/indexers/:id',
    zValidator('param', idParamsSchema),
    zValidator('json', indexerPatchSchema),
    async (c) => {
      const unsupported = requireMergePatch(c)
      if (unsupported) return unsupported
      const { id } = c.req.valid('param')
      const expectedUpdatedAt = ifMatchRevision(c)
      if (!expectedUpdatedAt) return problem(c, 428, 'precondition-required', 'If-Match is required')
      const item = await updateIndexer(c.get('deps'), id, c.req.valid('json'), expectedUpdatedAt)
      if (!item) return c.json({ error: 'Indexer not found.' }, 404)
      c.header('ETag', entityTag(item.updatedAt))
      return c.json({ item })
    },
  )

  routes.delete('/indexers/:id', zValidator('param', idParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const expectedUpdatedAt = ifMatchRevision(c)
    if (!expectedUpdatedAt) return problem(c, 428, 'precondition-required', 'If-Match is required')
    const deleted = await deleteIndexer(c.get('deps'), id, expectedUpdatedAt)
    if (!deleted) return c.json({ error: 'Indexer not found.' }, 404)
    return c.body(null, 204)
  })

  routes.post('/indexers/:id/health-observations', zValidator('param', idParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const health = await checkIndexerHealth(c.get('deps'), id)
    if (!health) return c.json({ error: 'Indexer not found.' }, 404)
    c.header('Location', `/api/indexers/${id}/health-observations/${encodeURIComponent(health.checkedAt as string)}`)
    return c.json({ item: health }, 201)
  })

  routes.get('/indexers/:id/health-observations', zValidator('param', idParamsSchema), async (c) => {
    const health = await getIndexerHealth(c.get('deps'), c.req.valid('param').id)
    if (!health) return c.json({ error: 'Indexer not found.' }, 404)
    return c.json({ items: health.checkedAt ? [health] : [] })
  })

  routes.get('/indexers/:id/health-observations/:checkedAt', zValidator('param', idParamsSchema), async (c) => {
    const health = await getIndexerHealth(c.get('deps'), c.req.param('id'))
    if (!health || health.checkedAt !== c.req.param('checkedAt'))
      return c.json({ error: 'Health observation not found.' }, 404)
    return c.json({ item: health })
  })
}

function parseNumberList(value: string | undefined): number[] {
  if (!value) return []
  return value
    .split(/[|,]/)
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0)
}
