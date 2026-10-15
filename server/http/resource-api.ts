import { Scalar } from '@scalar/hono-api-reference'
import { readOpenApiConfig } from '@server/config'
import { getActiveTmdbSource } from '@server/usecases/media-sources'
import type { Hono } from 'hono'
import { z } from 'zod'
import { catalogPage } from './catalog-representations'
import type { AppEnv } from './context'
import { openapiDocument } from './openapi'
import { problem } from './protocol'

export function registerPublicContractRoutes(routes: Hono<AppEnv>) {
  routes.get('/openapi.json', (c) => c.json(openapiDocument(readOpenApiConfig(c.env))))
  routes.get('/docs', Scalar({ url: '/api/openapi.json', pageTitle: 'ZME API' }))
}

export function registerResourceApiRoutes(routes: Hono<AppEnv>) {
  routes.get('/items', async (c) => {
    const parsed = z
      .object({
        q: z.string().trim().min(1).max(200),
        language: z.string().trim().max(35).optional(),
        types: z.enum(['movie', 'series', 'movie,series', 'series,movie']).default('movie,series'),
        page: z.coerce.number().int().positive().default(1),
        pageSize: z.coerce
          .number()
          .int()
          .refine((value) => value === 20, 'Page size must be 20')
          .default(20),
      })
      .strict()
      .safeParse(c.req.query())
    if (!parsed.success) return problem(c, 422, 'validation-error', 'Request validation failed')
    const input = parsed.data
    const kind = input.types === 'movie' ? 'movie' : input.types === 'series' ? 'tv' : undefined
    const source = await getActiveTmdbSource(c.get('deps'), input.language)
    const result = await c.get('deps').mediaProvider.searchPage(source, { query: input.q, page: input.page, kind })
    return c.json(catalogPage(c, result, input.pageSize, kind !== undefined))
  })
}
