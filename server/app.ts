import { zValidator } from '@hono/zod-validator'
import { type Context, Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { type AuthSession, type AuthUser, createAuth } from './auth'
import { createDb } from './db/client'
import type { Env } from './env'
import { getBookDetails, OpenLibraryError, searchBooks } from './services/books'
import { listDownloadTasks, streamDownloadTaskEvents } from './services/download-tasks'
import {
  checkDownloaderHealth,
  createDownloader,
  deleteDownloader,
  getDownloader,
  listDownloaders,
  submitDownload,
  updateDownloader,
} from './services/downloaders'
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
  deleteLibraryItem,
  deleteWatched,
  getLibraryItem,
  listLibrary,
  listLibraryStates,
  saveLibraryItem,
  setWatched,
} from './services/library'
import {
  deleteLibrarySource,
  listLibrarySources,
  saveLibrarySource,
  syncLibrarySource,
} from './services/library-sources'
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
import {
  discoverMedia,
  getMediaDetails,
  getPersonCredits,
  getPopularMedia,
  getSeasonDetails,
  getTrendingMedia,
  getWatchClickouts,
  listMediaGenres,
  searchMedia,
} from './services/tmdb'

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

const bookSearchQuerySchema = z.object({
  q: z.string().trim().min(1),
})

const bookParamsSchema = z.object({
  mediaKey: z.string().trim().min(1),
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

const mediaIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
})

const seasonParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  seasonNumber: z.coerce.number().int().min(0),
})

const personParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
})

const libraryItemParamsSchema = mediaDetailParamsSchema

const libraryQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(36),
  language: z.string().trim().min(2).optional(),
  kind: z.enum(['all', 'movie', 'tv', 'music', 'book']).default('all'),
  status: z.enum(['all', 'unwatched', 'watched']).default('all'),
})

const librarySourceParamsSchema = z.object({
  source: z.enum(['douban']),
})

const languageQuerySchema = z.object({
  language: z.string().trim().min(2).optional(),
})

const mediaDetailQuerySchema = languageQuerySchema.extend({
  watchRegion: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}$/)
    .default('US'),
})

const libraryItemSchema = z.object({
  id: z.number().int().positive(),
  kind: z.enum(['movie', 'tv']),
})

const librarySourceSchema = z.object({
  profileId: z.string().trim().min(1),
  enabled: z.boolean(),
})

const popularQuerySchema = z.object({
  kind: z.enum(['movie', 'tv']),
  language: z.string().trim().min(2).optional(),
})

const discoverQuerySchema = z.object({
  kind: z.enum(['movie', 'tv']),
  language: z.string().trim().min(2).optional(),
  page: z.coerce.number().int().positive().default(1),
  sortBy: z
    .enum(['popularity.desc', 'vote_average.desc', 'primary_release_date.desc', 'first_air_date.desc'])
    .default('popularity.desc'),
  genreId: z.coerce.number().int().positive().optional(),
  originCountry: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  year: z.coerce
    .number()
    .int()
    .min(1900)
    .max(new Date().getFullYear() + 2)
    .optional(),
  ratingGte: z.coerce.number().min(0).max(10).optional(),
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
  sourceType: z.enum(['magnet', 'torrent_url']),
  title: z.string().trim().optional(),
  category: z.string().trim().min(1).max(120).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
})

const downloadsQuerySchema = z.object({
  status: z
    .enum([
      'queued',
      'assigned',
      'running',
      'billing_paused',
      'pausing',
      'paused',
      'uploading',
      'canceling',
      'completed',
      'failed',
      'canceled',
    ])
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
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
routes.use('/media-sources', requireAdminMiddleware)
routes.use('/media-sources/*', requireAdminMiddleware)

routes.get('/tmdb/search', zValidator('query', searchQuerySchema), async (c) => {
  const { q, language } = c.req.valid('query')
  const source = await getActiveTmdbSource(createDb(c.env), language)
  const results = await searchMedia(source.apiKey, q, source.language)
  return c.json({ results })
})

routes.get('/books/search', zValidator('query', bookSearchQuerySchema), async (c) => {
  try {
    const results = await searchBooks(c.req.valid('query').q)
    return c.json({ results })
  } catch (error) {
    return openLibraryErrorResponse(c, error, 'Book search failed.')
  }
})

routes.get('/books/:mediaKey', zValidator('param', bookParamsSchema), async (c) => {
  try {
    const item = await getBookDetails(decodeURIComponent(c.req.valid('param').mediaKey))
    return c.json({ item })
  } catch (error) {
    return openLibraryErrorResponse(c, error, 'Book detail lookup failed.')
  }
})

routes.get('/tmdb/trending', zValidator('query', languageQuerySchema), async (c) => {
  const { language } = c.req.valid('query')
  const source = await getActiveTmdbSource(createDb(c.env), language)
  const results = await getTrendingMedia(source.apiKey, source.language)
  return c.json({ results })
})

routes.get('/tmdb/popular', zValidator('query', popularQuerySchema), async (c) => {
  const { kind, language } = c.req.valid('query')
  const source = await getActiveTmdbSource(createDb(c.env), language)
  const results = await getPopularMedia(source.apiKey, kind, source.language)
  return c.json({ results })
})

routes.get('/tmdb/discover', zValidator('query', discoverQuerySchema), async (c) => {
  const input = c.req.valid('query')
  const source = await getActiveTmdbSource(createDb(c.env), input.language)
  const page = await discoverMedia(source.apiKey, {
    ...input,
    language: source.language,
  })
  return c.json(page)
})

routes.get('/tmdb/genres', zValidator('query', popularQuerySchema), async (c) => {
  const { kind, language } = c.req.valid('query')
  const source = await getActiveTmdbSource(createDb(c.env), language)
  const genres = await listMediaGenres(source.apiKey, kind, source.language)
  return c.json({ genres })
})

routes.get(
  '/people/:id/credits',
  zValidator('param', personParamsSchema),
  zValidator('query', languageQuerySchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const { language } = c.req.valid('query')
    const source = await getActiveTmdbSource(createDb(c.env), language)
    const credits = await getPersonCredits(source.apiKey, id, source.language)
    return c.json(credits)
  },
)

routes.get(
  '/movies/:id/watch-clickouts',
  zValidator('param', mediaIdParamsSchema),
  zValidator('query', mediaDetailQuerySchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const { watchRegion } = c.req.valid('query')
    const clickouts = await getWatchClickouts('movie', id, watchRegion)
    return c.json({ clickouts })
  },
)

routes.get(
  '/series/:id/watch-clickouts',
  zValidator('param', mediaIdParamsSchema),
  zValidator('query', mediaDetailQuerySchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const { watchRegion } = c.req.valid('query')
    const clickouts = await getWatchClickouts('tv', id, watchRegion)
    return c.json({ clickouts })
  },
)

routes.get(
  '/movies/:id',
  zValidator('param', mediaIdParamsSchema),
  zValidator('query', mediaDetailQuerySchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const { language, watchRegion } = c.req.valid('query')
    const source = await getActiveTmdbSource(createDb(c.env), language)
    const item = await getMediaDetails(source.apiKey, 'movie', id, source.language, watchRegion)
    return c.json({ item })
  },
)

routes.get(
  '/series/:id/seasons/:seasonNumber',
  zValidator('param', seasonParamsSchema),
  zValidator('query', languageQuerySchema),
  async (c) => {
    const { id, seasonNumber } = c.req.valid('param')
    const { language } = c.req.valid('query')
    const source = await getActiveTmdbSource(createDb(c.env), language)
    const item = await getSeasonDetails(source.apiKey, id, seasonNumber, source.language)
    return c.json({ item })
  },
)

routes.get(
  '/series/:id',
  zValidator('param', mediaIdParamsSchema),
  zValidator('query', mediaDetailQuerySchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const { language, watchRegion } = c.req.valid('query')
    const source = await getActiveTmdbSource(createDb(c.env), language)
    const item = await getMediaDetails(source.apiKey, 'tv', id, source.language, watchRegion)
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

routes.get('/library', zValidator('query', libraryQuerySchema), async (c) => {
  const db = createDb(c.env)
  const input = c.req.valid('query')
  const tmdb = input.kind === 'music' || input.kind === 'book' ? null : await getActiveTmdbSource(db, input.language)
  return c.json(await listLibrary(db, c.get('user').id, tmdb, input))
})

routes.get('/library/states', async (c) => {
  const items = await listLibraryStates(createDb(c.env), c.get('user').id)
  return c.json({ items })
})

routes.get('/library/sources', async (c) => {
  const items = await listLibrarySources(createDb(c.env), c.get('user').id)
  return c.json({ items })
})

routes.put(
  '/library/sources/:source',
  zValidator('param', librarySourceParamsSchema),
  zValidator('json', librarySourceSchema),
  async (c) => {
    const { source } = c.req.valid('param')
    const item = await saveLibrarySource(createDb(c.env), c.get('user').id, source, c.req.valid('json'))
    return c.json({ item })
  },
)

routes.delete('/library/sources/:source', zValidator('param', librarySourceParamsSchema), async (c) => {
  const { source } = c.req.valid('param')
  const deleted = await deleteLibrarySource(createDb(c.env), c.get('user').id, source)
  if (!deleted) return c.json({ error: 'Library source not found.' }, 404)
  return c.json({ source })
})

routes.post('/library/sources/:source/sync', zValidator('param', librarySourceParamsSchema), async (c) => {
  const db = createDb(c.env)
  const tmdb = await getActiveTmdbSource(db)
  const result = await syncLibrarySource(db, c.get('user').id, c.req.valid('param').source, tmdb)
  return c.json({ result })
})

routes.get('/library/:kind/:id', zValidator('param', libraryItemParamsSchema), async (c) => {
  const { kind, id } = c.req.valid('param')
  const db = createDb(c.env)
  const item = await getLibraryItem(db, c.get('user').id, kind, id, await getActiveTmdbSource(db))
  if (!item) return c.json({ error: 'Library item not found.' }, 404)
  return c.json({ item })
})

routes.put(
  '/library/:kind/:id',
  zValidator('param', libraryItemParamsSchema),
  zValidator('json', libraryItemSchema),
  async (c) => {
    const { kind, id } = c.req.valid('param')
    const input = c.req.valid('json')
    if (input.kind !== kind || input.id !== id)
      return c.json({ error: 'Library route does not match request body.' }, 400)

    const db = createDb(c.env)
    const item = await saveLibraryItem(db, c.get('user').id, input, await getActiveTmdbSource(db))
    return c.json({ item })
  },
)

routes.delete('/library/:kind/:id', zValidator('param', libraryItemParamsSchema), async (c) => {
  const { kind, id } = c.req.valid('param')
  const deleted = await deleteLibraryItem(createDb(c.env), c.get('user').id, kind, id)
  if (!deleted) return c.json({ error: 'Library item not found.' }, 404)
  return c.json({ kind, id })
})

routes.put(
  '/library/:kind/:id/watched',
  zValidator('param', libraryItemParamsSchema),
  zValidator('json', libraryItemSchema),
  async (c) => {
    const { kind, id } = c.req.valid('param')
    const input = c.req.valid('json')
    if (input.kind !== kind || input.id !== id)
      return c.json({ error: 'Library route does not match request body.' }, 400)

    const db = createDb(c.env)
    const item = await setWatched(db, c.get('user').id, input, true, await getActiveTmdbSource(db))
    return c.json({ item })
  },
)

routes.delete('/library/:kind/:id/watched', zValidator('param', libraryItemParamsSchema), async (c) => {
  const { kind, id } = c.req.valid('param')
  const db = createDb(c.env)
  const item = await deleteWatched(db, c.get('user').id, kind, id, await getActiveTmdbSource(db))
  return c.json({ item, kind, id })
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
  const items = await listDownloaders(createDb(c.env), c.get('user').id)
  return c.json({ items })
})

routes.get('/downloaders/:id', zValidator('param', idParamsSchema), async (c) => {
  const { id } = c.req.valid('param')
  const item = await getDownloader(createDb(c.env), c.get('user').id, id)
  if (!item) return c.json({ error: 'Downloader not found.' }, 404)
  return c.json({ item })
})

routes.post('/downloaders', zValidator('json', downloaderSchema), async (c) => {
  const item = await createDownloader(createDb(c.env), c.get('user').id, c.req.valid('json'))
  return c.json({ item }, 201)
})

routes.patch(
  '/downloaders/:id',
  zValidator('param', idParamsSchema),
  zValidator('json', downloaderSchema),
  async (c) => {
    const { id } = c.req.valid('param')
    const item = await updateDownloader(createDb(c.env), c.get('user').id, id, c.req.valid('json'))
    if (!item) return c.json({ error: 'Downloader not found.' }, 404)
    return c.json({ item })
  },
)

routes.delete('/downloaders/:id', zValidator('param', idParamsSchema), async (c) => {
  const { id } = c.req.valid('param')
  const deleted = await deleteDownloader(createDb(c.env), c.get('user').id, id)
  if (!deleted) return c.json({ error: 'Downloader not found.' }, 404)
  return c.json({ id })
})

routes.post('/downloaders/:id/health', zValidator('param', idParamsSchema), async (c) => {
  const { id } = c.req.valid('param')
  const health = await checkDownloaderHealth(createDb(c.env), c.get('user').id, id)
  if (!health) return c.json({ error: 'Downloader not found.' }, 404)
  return c.json({ health })
})

routes.get('/downloads', zValidator('query', downloadsQuerySchema), async (c) => {
  const result = await listDownloadTasks(createDb(c.env), c.get('user').id, c.req.valid('query'))
  return c.json(result)
})

routes.get('/downloads/events', async (c) => {
  return streamDownloadTaskEvents(createDb(c.env), c.get('user').id, c.req.raw.signal)
})

routes.post('/downloads', zValidator('json', createDownloadSchema), async (c) => {
  try {
    const item = await submitDownload(createDb(c.env), c.get('user').id, c.req.valid('json'))
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

function isAdmin(user: AuthUser): boolean {
  return (user.role || '').split(',').includes('admin')
}

function openLibraryErrorResponse(c: Context<AppEnv>, error: unknown, fallback: string) {
  if (error instanceof OpenLibraryError) {
    const status = error.status === 400 || error.status === 404 ? error.status : 502
    return c.json({ code: status === 404 ? 'BOOK_NOT_FOUND' : 'OPEN_LIBRARY_ERROR', error: error.message }, status)
  }
  return c.json({ code: 'OPEN_LIBRARY_ERROR', error: error instanceof Error ? error.message : fallback }, 502)
}
