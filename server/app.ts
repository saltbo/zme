import { zValidator } from '@hono/zod-validator'
import { Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { type AuthSession, type AuthUser, createAuth } from './auth'
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
import {
  checkMediaSourceHealth,
  createMediaSource,
  deleteMediaSource,
  getActiveTmdbSource,
  getMediaSource,
  listMediaSources,
  updateMediaSource,
} from './services/media-sources'
import { createInitialAdmin, isInitialized } from './services/setup'
import { getMediaDetails, getPopularMedia, getTrendingMedia, searchMedia } from './services/tmdb'

type AppEnv = {
  Bindings: Env
  Variables: {
    user: AuthUser
    session: NonNullable<AuthSession>['session']
  }
}

const searchQuerySchema = z.object({
  q: z.string().trim().min(1),
  language: z.string().trim().min(2).optional(),
})

const indexerSearchQuerySchema = z.object({
  q: z.string().trim().min(1),
  title: z.string().trim().min(1).optional(),
  aliases: z.string().trim().optional(),
  year: z
    .string()
    .trim()
    .regex(/^(19|20)\d{2}$/)
    .optional(),
  kind: z.enum(['movie', 'tv']).optional(),
  imdbId: z
    .string()
    .trim()
    .regex(/^tt\d+$/i)
    .optional(),
  tmdbId: z.coerce.number().int().positive().optional(),
  tvdbId: z.coerce.number().int().positive().optional(),
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

const mediaSourceSchema = z.object({
  description: z.string().trim().optional(),
  kind: z.enum(['tmdb']),
  credentials: z.record(z.string(), z.string()),
  options: z.record(z.string(), z.string()),
  enabled: z.boolean(),
})

const idParamsSchema = z.object({
  id: z.string().trim().min(1),
})

const createDownloadSchema = z.object({
  downloaderId: z.string().trim().min(1),
  uri: z.string().trim().min(1),
  title: z.string().trim().optional(),
})

const setupAdminSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  password: z.string().min(8),
})

const routes = new Hono<AppEnv>()

routes.get('/health', (c) =>
  c.json({
    ok: true,
    name: 'zme',
  }),
)

routes.get('/setup/status', async (c) => {
  const initialized = await isInitialized(createDb(c.env))
  return c.json({ initialized })
})

routes.post('/setup/admin', zValidator('json', setupAdminSchema), async (c) => {
  try {
    const user = await createInitialAdmin(createDb(c.env), createAuth(c.env, c.req.raw), c.req.valid('json'))
    return c.json({ user }, 201)
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Setup failed.' }, 409)
  }
})

routes.use('*', async (c, next) => {
  const session = await createAuth(c.env, c.req.raw).api.getSession({ headers: c.req.raw.headers })
  if (!session) {
    return c.json({ error: 'Authentication required.' }, 401)
  }

  c.set('user', session.user)
  c.set('session', session.session)
  await next()
})

routes.use('/indexers/*', requireAdminExceptIndexerSearchMiddleware)
routes.use('/indexers', requireAdminMiddleware)
routes.use('/downloaders', requireAdminExceptDownloaderListMiddleware)
routes.use('/downloaders/*', requireAdminMiddleware)
routes.use('/media-sources', requireAdminMiddleware)
routes.use('/media-sources/*', requireAdminMiddleware)

routes.get('/media/search', zValidator('query', searchQuerySchema), async (c) => {
  const { q, language } = c.req.valid('query')
  const source = await getActiveTmdbSource(createDb(c.env), language)
  const results = await searchMedia(source.apiKey, q, source.language)
  return c.json({ results })
})

routes.get('/media/trending', zValidator('query', languageQuerySchema), async (c) => {
  const { language } = c.req.valid('query')
  const source = await getActiveTmdbSource(createDb(c.env), language)
  const results = await getTrendingMedia(source.apiKey, source.language)
  return c.json({ results })
})

routes.get('/media/popular', zValidator('query', popularQuerySchema), async (c) => {
  const { kind, language } = c.req.valid('query')
  const source = await getActiveTmdbSource(createDb(c.env), language)
  const results = await getPopularMedia(source.apiKey, kind, source.language)
  return c.json({ results })
})

routes.get(
  '/media/:kind/:id',
  zValidator('param', mediaDetailParamsSchema),
  zValidator('query', languageQuerySchema),
  async (c) => {
    const { kind, id } = c.req.valid('param')
    const { language } = c.req.valid('query')
    const source = await getActiveTmdbSource(createDb(c.env), language)
    const item = await getMediaDetails(source.apiKey, kind, id, source.language)
    return c.json({ item })
  },
)

routes.get('/indexers/search', zValidator('query', indexerSearchQuerySchema), async (c) => {
  const { q, title, aliases, year, kind, imdbId, tmdbId, tvdbId } = c.req.valid('query')
  try {
    const results = await searchIndexers(createDb(c.env), {
      query: q,
      title,
      aliases: parseAliases(aliases),
      year,
      kind,
      imdbId,
      tmdbId,
      tvdbId,
    })
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

function parseAliases(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean)
}

routes.get('/favorites', async (c) => {
  const items = await listFavorites(createDb(c.env), c.get('user').id)
  return c.json({ items })
})

routes.get('/favorites/:kind/:id', zValidator('param', favoriteParamsSchema), async (c) => {
  const { kind, id } = c.req.valid('param')
  const item = await getFavorite(createDb(c.env), c.get('user').id, kind, id)
  if (!item) return c.json({ error: 'Favorite not found.' }, 404)
  return c.json({ item })
})

routes.post('/favorites', zValidator('json', favoriteSchema), async (c) => {
  const item = await saveFavorite(createDb(c.env), c.get('user').id, c.req.valid('json'))
  return c.json({ item }, 201)
})

routes.delete('/favorites/:kind/:id', zValidator('param', favoriteParamsSchema), async (c) => {
  const { kind, id } = c.req.valid('param')
  const deleted = await deleteFavorite(createDb(c.env), c.get('user').id, kind, id)
  if (!deleted) return c.json({ error: 'Favorite not found.' }, 404)
  return c.json({ kind, id })
})

routes.get('/media-sources', async (c) => {
  const items = await listMediaSources(createDb(c.env))
  return c.json({ items })
})

routes.get('/media-sources/:id', zValidator('param', idParamsSchema), async (c) => {
  const { id } = c.req.valid('param')
  const item = await getMediaSource(createDb(c.env), id)
  if (!item) return c.json({ error: 'Media source not found.' }, 404)
  return c.json({ item })
})

routes.post('/media-sources', zValidator('json', mediaSourceSchema), async (c) => {
  const item = await createMediaSource(createDb(c.env), c.req.valid('json'))
  return c.json({ item }, 201)
})

routes.patch(
  '/media-sources/:id',
  zValidator('param', idParamsSchema),
  zValidator('json', mediaSourceSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const item = await updateMediaSource(createDb(c.env), id, c.req.valid('json'))
    if (!item) return c.json({ error: 'Media source not found.' }, 404)
    return c.json({ item })
  },
)

routes.delete('/media-sources/:id', zValidator('param', idParamsSchema), async (c) => {
  const { id } = c.req.valid('param')
  const deleted = await deleteMediaSource(createDb(c.env), id)
  if (!deleted) return c.json({ error: 'Media source not found.' }, 404)
  return c.json({ id })
})

routes.post('/media-sources/:id/health', zValidator('param', idParamsSchema), async (c) => {
  const { id } = c.req.valid('param')
  const health = await checkMediaSourceHealth(createDb(c.env), id)
  if (!health) return c.json({ error: 'Media source not found.' }, 404)
  return c.json({ health })
})

routes.get('/indexers', async (c) => {
  const items = await listIndexers(createDb(c.env))
  return c.json({ items })
})

routes.get('/indexers/:id', zValidator('param', idParamsSchema), async (c) => {
  const { id } = c.req.valid('param')
  const item = await getIndexer(createDb(c.env), id)
  if (!item) return c.json({ error: 'Indexer not found.' }, 404)
  return c.json({ item })
})

routes.post('/indexers', zValidator('json', indexerSchema), async (c) => {
  const item = await createIndexer(createDb(c.env), c.req.valid('json'))
  return c.json({ item }, 201)
})

routes.patch('/indexers/:id', zValidator('param', idParamsSchema), zValidator('json', indexerSchema), async (c) => {
  const { id } = c.req.valid('param')
  const item = await updateIndexer(createDb(c.env), id, c.req.valid('json'))
  if (!item) return c.json({ error: 'Indexer not found.' }, 404)
  return c.json({ item })
})

routes.delete('/indexers/:id', zValidator('param', idParamsSchema), async (c) => {
  const { id } = c.req.valid('param')
  const deleted = await deleteIndexer(createDb(c.env), id)
  if (!deleted) return c.json({ error: 'Indexer not found.' }, 404)
  return c.json({ id })
})

routes.post('/indexers/:id/health', zValidator('param', idParamsSchema), async (c) => {
  const { id } = c.req.valid('param')
  const health = await checkIndexerHealth(createDb(c.env), id)
  if (!health) return c.json({ error: 'Indexer not found.' }, 404)
  return c.json({ health })
})

routes.get('/downloaders', async (c) => {
  const items = await listDownloaders(createDb(c.env))
  return c.json({ items })
})

routes.get('/downloaders/:id', zValidator('param', idParamsSchema), async (c) => {
  const { id } = c.req.valid('param')
  const item = await getDownloader(createDb(c.env), id)
  if (!item) return c.json({ error: 'Downloader not found.' }, 404)
  return c.json({ item })
})

routes.post('/downloaders', zValidator('json', downloaderSchema), async (c) => {
  const item = await createDownloader(createDb(c.env), c.req.valid('json'))
  return c.json({ item }, 201)
})

routes.patch(
  '/downloaders/:id',
  zValidator('param', idParamsSchema),
  zValidator('json', downloaderSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const item = await updateDownloader(createDb(c.env), id, c.req.valid('json'))
    if (!item) return c.json({ error: 'Downloader not found.' }, 404)
    return c.json({ item })
  },
)

routes.delete('/downloaders/:id', zValidator('param', idParamsSchema), async (c) => {
  const { id } = c.req.valid('param')
  const deleted = await deleteDownloader(createDb(c.env), id)
  if (!deleted) return c.json({ error: 'Downloader not found.' }, 404)
  return c.json({ id })
})

routes.post('/downloaders/:id/health', zValidator('param', idParamsSchema), async (c) => {
  const { id } = c.req.valid('param')
  const health = await checkDownloaderHealth(createDb(c.env), id)
  if (!health) return c.json({ error: 'Downloader not found.' }, 404)
  return c.json({ health })
})

routes.post('/downloads', zValidator('json', createDownloadSchema), async (c) => {
  try {
    const item = await submitDownload(createDb(c.env), c.req.valid('json'))
    return c.json({ item }, 201)
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Download submission failed.' }, 502)
  }
})

const typedApiApp = new Hono<{ Bindings: Env }>().route('/api', routes)

const app = new Hono<{ Bindings: Env }>()
  .on(['POST', 'GET'], '/api/auth/*', (c) => createAuth(c.env, c.req.raw).handler(c.req.raw))
  .route('/api', routes)

export type AppType = typeof typedApiApp

export { app }

async function requireAdminMiddleware(c: Parameters<MiddlewareHandler<AppEnv>>[0], next: () => Promise<void>) {
  if (!isAdmin(c.get('user'))) {
    return c.json({ error: 'Administrator access required.' }, 403)
  }
  await next()
}

async function requireAdminExceptIndexerSearchMiddleware(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  next: () => Promise<void>,
) {
  if (c.req.path.endsWith('/indexers/search')) {
    await next()
    return
  }
  return requireAdminMiddleware(c, next)
}

async function requireAdminExceptDownloaderListMiddleware(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  next: () => Promise<void>,
) {
  if (c.req.method === 'GET') {
    await next()
    return
  }
  return requireAdminMiddleware(c, next)
}

function isAdmin(user: AuthUser): boolean {
  return (user.role || '').split(',').includes('admin')
}
