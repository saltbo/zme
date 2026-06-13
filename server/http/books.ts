import { zValidator } from '@hono/zod-validator'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import { BookProviderError } from '../usecases/ports'
import type { AppEnv } from './context'

const bookSearchQuerySchema = z.object({
  q: z.string().trim().min(1),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(20),
})

const bookDiscoverQuerySchema = z.object({
  mode: z.enum(['trending', 'subject']).default('trending'),
  period: z.enum(['daily', 'weekly', 'monthly', 'yearly']).default('daily'),
  subject: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(20),
})

export const mediaKeyParamsSchema = z.object({
  mediaKey: z.string().trim().min(1),
})

export function registerBookRoutes(routes: Hono<AppEnv>) {
  routes.get('/books/search', zValidator('query', bookSearchQuerySchema), async (c) => {
    const { q, page, pageSize } = c.req.valid('query')
    try {
      return c.json(await c.get('deps').bookProvider.search(q, page, pageSize))
    } catch (error) {
      return bookProviderErrorResponse(c, error, 'Book search failed.')
    }
  })

  routes.get('/books/discover', zValidator('query', bookDiscoverQuerySchema), async (c) => {
    try {
      return c.json(await c.get('deps').bookProvider.discover(c.req.valid('query')))
    } catch (error) {
      return bookProviderErrorResponse(c, error, 'Book discovery failed.')
    }
  })

  routes.get('/books/:mediaKey', zValidator('param', mediaKeyParamsSchema), async (c) => {
    try {
      const item = await c.get('deps').bookProvider.details(decodeURIComponent(c.req.valid('param').mediaKey))
      return c.json({ item })
    } catch (error) {
      return bookProviderErrorResponse(c, error, 'Book detail lookup failed.')
    }
  })
}

function bookProviderErrorResponse(c: Context<AppEnv>, error: unknown, fallback: string) {
  if (error instanceof BookProviderError) {
    const status = error.status === 400 || error.status === 404 ? error.status : 502
    return c.json({ code: status === 404 ? 'BOOK_NOT_FOUND' : 'OPEN_LIBRARY_ERROR', error: error.message }, status)
  }
  return c.json({ code: 'OPEN_LIBRARY_ERROR', error: error instanceof Error ? error.message : fallback }, 502)
}
