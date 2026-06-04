import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { createDb } from './db/client'
import type { Env } from './env'
import {
  checkDownloaderHealth,
  createDownloader,
  deleteDownloader,
  getDownloader,
  listDownloaders,
  submitDownload,
  updateDownloader,
} from './services/downloaders'
import { deleteFavorite, getFavorite, listFavorites, saveFavorite } from './services/favorites'
import {
  checkIndexerHealth,
  createIndexer,
  deleteIndexer,
  getIndexer,
  listIndexers,
  searchIndexers,
  updateIndexer,
} from './services/indexers'
import { getMediaDetails, getPopularMedia, getTrendingMedia, searchMedia } from './services/tmdb'

const searchQuerySchema = z.object({
  q: z.string().trim().min(1),
  language: z.string().trim().min(2).optional(),
})

const mediaDetailParamsSchema = z.object({
  kind: z.enum(['movie', 'tv']),
  id: z.coerce.number().int().positive(),
})

const favoriteParamsSchema = mediaDetailParamsSchema

const languageQuerySchema = z.object({
  language: z.string().trim().min(2).optional(),
})

const favoriteSchema = z.object({
  id: z.number().int().positive(),
  kind: z.enum(['movie', 'tv']),
  title: z.string().trim().min(1),
  originalTitle: z.string(),
  overview: z.string(),
  posterUrl: z.string().nullable(),
  backdropUrl: z.string().nullable(),
  releaseYear: z.string().nullable(),
  rating: z.number().nullable(),
})

const popularQuerySchema = z.object({
  kind: z.enum(['movie', 'tv']),
  language: z.string().trim().min(2).optional(),
})

const downloaderSchema = z.object({
  description: z.string().trim().optional(),
  kind: z.enum(['zpan', 'qbittorrent', 'transmission', 'aria2']),
  endpoint: z.string().trim().url(),
  credentials: z.record(z.string(), z.string()),
  options: z.record(z.string(), z.string()),
  enabled: z.boolean(),
})

const indexerSchema = z.object({
  description: z.string().trim().optional(),
  kind: z.enum(['prowlarr']),
  endpoint: z.string().trim().url(),
  credentials: z.record(z.string(), z.string()),
  options: z.record(z.string(), z.string()),
  enabled: z.boolean(),
})

const indexerParamsSchema = z.object({
  id: z.string().trim().min(1),
})

const downloaderParamsSchema = z.object({
  id: z.string().trim().min(1),
})

const createDownloadSchema = z.object({
  downloaderId: z.string().trim().min(1),
  uri: z.string().trim().min(1),
  title: z.string().trim().optional(),
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
    const { q } = c.req.valid('query')
    try {
      const results = await searchIndexers(createDb(c.env), q)
      return c.json({ results })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Indexer search failed.'
      const notConfigured = message.includes('No enabled indexers')
      return c.json(
        {
          code: notConfigured ? 'INDEXER_NOT_CONFIGURED' : 'INDEXER_SEARCH_FAILED',
          error: message,
        },
        notConfigured ? 503 : 502,
      )
    }
  })
  .get('/favorites', async (c) => {
    const items = await listFavorites(createDb(c.env))
    return c.json({ items })
  })
  .get('/favorites/:kind/:id', zValidator('param', favoriteParamsSchema), async (c) => {
    const { kind, id } = c.req.valid('param')
    const item = await getFavorite(createDb(c.env), kind, id)
    if (!item) return c.json({ error: 'Favorite not found.' }, 404)
    return c.json({ item })
  })
  .post('/favorites', zValidator('json', favoriteSchema), async (c) => {
    const item = await saveFavorite(createDb(c.env), c.req.valid('json'))
    return c.json({ item }, 201)
  })
  .delete('/favorites/:kind/:id', zValidator('param', favoriteParamsSchema), async (c) => {
    const { kind, id } = c.req.valid('param')
    const deleted = await deleteFavorite(createDb(c.env), kind, id)
    if (!deleted) return c.json({ error: 'Favorite not found.' }, 404)
    return c.json({ kind, id })
  })
  .get('/indexers', async (c) => {
    const items = await listIndexers(createDb(c.env))
    return c.json({ items })
  })
  .get('/indexers/:id', zValidator('param', indexerParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const item = await getIndexer(createDb(c.env), id)
    if (!item) return c.json({ error: 'Indexer not found.' }, 404)
    return c.json({ item })
  })
  .post('/indexers', zValidator('json', indexerSchema), async (c) => {
    const item = await createIndexer(createDb(c.env), c.req.valid('json'))
    return c.json({ item }, 201)
  })
  .patch('/indexers/:id', zValidator('param', indexerParamsSchema), zValidator('json', indexerSchema), async (c) => {
    const { id } = c.req.valid('param')
    const item = await updateIndexer(createDb(c.env), id, c.req.valid('json'))
    if (!item) return c.json({ error: 'Indexer not found.' }, 404)
    return c.json({ item })
  })
  .delete('/indexers/:id', zValidator('param', indexerParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const deleted = await deleteIndexer(createDb(c.env), id)
    if (!deleted) return c.json({ error: 'Indexer not found.' }, 404)
    return c.json({ id })
  })
  .post('/indexers/:id/health', zValidator('param', indexerParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const health = await checkIndexerHealth(createDb(c.env), id)
    if (!health) return c.json({ error: 'Indexer not found.' }, 404)
    return c.json({ health })
  })
  .get('/downloaders', async (c) => {
    const items = await listDownloaders(createDb(c.env))
    return c.json({ items })
  })
  .get('/downloaders/:id', zValidator('param', downloaderParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const item = await getDownloader(createDb(c.env), id)
    if (!item) return c.json({ error: 'Downloader not found.' }, 404)
    return c.json({ item })
  })
  .post('/downloaders', zValidator('json', downloaderSchema), async (c) => {
    const item = await createDownloader(createDb(c.env), c.req.valid('json'))
    return c.json({ item }, 201)
  })
  .patch(
    '/downloaders/:id',
    zValidator('param', downloaderParamsSchema),
    zValidator('json', downloaderSchema),
    async (c) => {
      const { id } = c.req.valid('param')
      const item = await updateDownloader(createDb(c.env), id, c.req.valid('json'))
      if (!item) return c.json({ error: 'Downloader not found.' }, 404)
      return c.json({ item })
    },
  )
  .delete('/downloaders/:id', zValidator('param', downloaderParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const deleted = await deleteDownloader(createDb(c.env), id)
    if (!deleted) return c.json({ error: 'Downloader not found.' }, 404)
    return c.json({ id })
  })
  .post('/downloaders/:id/health', zValidator('param', downloaderParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const health = await checkDownloaderHealth(createDb(c.env), id)
    if (!health) return c.json({ error: 'Downloader not found.' }, 404)
    return c.json({ health })
  })
  .post('/downloads', zValidator('json', createDownloadSchema), async (c) => {
    try {
      const item = await submitDownload(createDb(c.env), c.req.valid('json'))
      return c.json({ item }, 201)
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Download submission failed.' }, 502)
    }
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
