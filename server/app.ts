import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from './env'
import { searchIndexers } from './services/prowlarr'
import { getMediaDetails, getPopularMedia, getTrendingMedia, searchMedia } from './services/tmdb'

const searchQuerySchema = z.object({
  q: z.string().trim().min(1),
  language: z.string().trim().min(2).optional(),
})

const mediaDetailParamsSchema = z.object({
  kind: z.enum(['movie', 'tv']),
  id: z.coerce.number().int().positive(),
})

const languageQuerySchema = z.object({
  language: z.string().trim().min(2).optional(),
})

const popularQuerySchema = z.object({
  kind: z.enum(['movie', 'tv']),
  language: z.string().trim().min(2).optional(),
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

    const { q, language } = c.req.valid('query')
    const results = await searchMedia(apiKey, q, getTmdbLanguage(c.env, language))
    return c.json({ results })
  })
  .get('/media/trending', zValidator('query', languageQuerySchema), async (c) => {
    const apiKey = c.env.TMDB_API_KEY
    if (!apiKey) {
      return c.json({ error: 'TMDB_API_KEY is not configured.' }, 500)
    }

    const { language } = c.req.valid('query')
    const results = await getTrendingMedia(apiKey, getTmdbLanguage(c.env, language))
    return c.json({ results })
  })
  .get('/media/popular', zValidator('query', popularQuerySchema), async (c) => {
    const apiKey = c.env.TMDB_API_KEY
    if (!apiKey) {
      return c.json({ error: 'TMDB_API_KEY is not configured.' }, 500)
    }

    const { kind, language } = c.req.valid('query')
    const results = await getPopularMedia(apiKey, kind, getTmdbLanguage(c.env, language))
    return c.json({ results })
  })
  .get(
    '/media/:kind/:id',
    zValidator('param', mediaDetailParamsSchema),
    zValidator('query', languageQuerySchema),
    async (c) => {
      const apiKey = c.env.TMDB_API_KEY
      if (!apiKey) {
        return c.json({ error: 'TMDB_API_KEY is not configured.' }, 500)
      }

      const { kind, id } = c.req.valid('param')
      const { language } = c.req.valid('query')
      const item = await getMediaDetails(apiKey, kind, id, getTmdbLanguage(c.env, language))
      return c.json({ item })
    },
  )
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

function getTmdbLanguage(env: Env, language?: string): string {
  return language || env.TMDB_LANGUAGE || 'zh-CN'
}
