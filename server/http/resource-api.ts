import { readConfig } from '@server/config'
import { searchMedia } from '@server/usecases/media'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from './context'
import { openapiDocument } from './openapi'
import { problem } from './protocol'

export function registerPublicContractRoutes(routes: Hono<AppEnv>) {
  routes.get('/openapi.json', (c) => c.json(openapiDocument(readConfig(c.env))))
}

export function registerResourceApiRoutes(routes: Hono<AppEnv>) {
  routes.get('/media', async (c) => {
    const parsed = z
      .object({
        query: z.string().trim().min(1).max(200),
        language: z.string().trim().max(35).optional(),
        kind: z.enum(['movie', 'tv']).optional(),
      })
      .safeParse(c.req.query())
    if (!parsed.success) return problem(c, 422, 'validation-error', 'Request validation failed')
    const items = (await searchMedia(c.get('deps'), parsed.data.query, parsed.data.language)).filter(
      (item) => !parsed.data.kind || item.kind === parsed.data.kind,
    )
    return c.json({
      items: items.map((item) => ({ ...item, mediaKey: `tmdb:${item.kind}:${item.id}` })),
      pagination: { page: 1, pageSize: items.length, totalItems: items.length, totalPages: items.length ? 1 : 0 },
    })
  })
}
