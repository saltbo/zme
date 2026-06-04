import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from './env'
import { searchIndexers } from './services/prowlarr'
import { searchMedia } from './services/tmdb'

const searchQuerySchema = z.object({
  q: z.string().trim().min(1),
})

const routes = new Hono<{ Bindings: Env }>()
  .get('/health', (c) =>
    c.json({
      ok: true,
      name: 'zme',
    }),
  )
  .get('/media/search', zValidator('query', searchQuerySchema), async (c) => {
    const apiKey = c.env.TMDB_API_KEY
    if (!apiKey) {
      return c.json({ error: 'TMDB_API_KEY is not configured.' }, 500)
    }

    const { q } = c.req.valid('query')
    const results = await searchMedia(apiKey, q)
    return c.json({ results })
  })
  .get('/indexers/search', zValidator('query', searchQuerySchema), async (c) => {
    const baseUrl = c.env.PROWLARR_URL
    const apiKey = c.env.PROWLARR_API_KEY
    if (!baseUrl || !apiKey) {
      return c.json({ results: [] })
    }

    const { q } = c.req.valid('query')
    const results = await searchIndexers(baseUrl, apiKey, q)
    return c.json({ results })
  })
  .get('/zpan/save-url', zValidator('query', z.object({ uri: z.string().trim().min(1) })), (c) => {
    const zpanBaseUrl = c.env.ZPAN_BASE_URL || 'http://localhost:5174'
    const { uri } = c.req.valid('query')
    const url = new URL('/downloads/new', zpanBaseUrl)
    url.searchParams.set('uri', uri)
    return c.json({ url: url.toString() })
  })

const app = new Hono<{ Bindings: Env }>().route('/api', routes)

export type AppType = typeof app

export { app }
