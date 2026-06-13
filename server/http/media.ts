import { zValidator } from '@hono/zod-validator'
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
} from '@server/usecases/media'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from './context'

const searchQuerySchema = z.object({
  q: z.string().trim().min(1),
  language: z.string().trim().min(2).optional(),
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

export function registerMediaRoutes(routes: Hono<AppEnv>) {
  routes.get('/tmdb/search', zValidator('query', searchQuerySchema), async (c) => {
    const { q, language } = c.req.valid('query')
    const results = await searchMedia(c.get('deps'), q, language)
    return c.json({ results })
  })

  routes.get('/tmdb/trending', zValidator('query', languageQuerySchema), async (c) => {
    const { language } = c.req.valid('query')
    const results = await getTrendingMedia(c.get('deps'), language)
    return c.json({ results })
  })

  routes.get('/tmdb/popular', zValidator('query', popularQuerySchema), async (c) => {
    const { kind, language } = c.req.valid('query')
    const results = await getPopularMedia(c.get('deps'), kind, language)
    return c.json({ results })
  })

  routes.get('/tmdb/discover', zValidator('query', discoverQuerySchema), async (c) => {
    const page = await discoverMedia(c.get('deps'), c.req.valid('query'))
    return c.json(page)
  })

  routes.get('/tmdb/genres', zValidator('query', popularQuerySchema), async (c) => {
    const { kind, language } = c.req.valid('query')
    const genres = await listMediaGenres(c.get('deps'), kind, language)
    return c.json({ genres })
  })

  routes.get(
    '/people/:id/credits',
    zValidator('param', personParamsSchema),
    zValidator('query', languageQuerySchema),
    async (c) => {
      const { id } = c.req.valid('param')
      const { language } = c.req.valid('query')
      const credits = await getPersonCredits(c.get('deps'), id, language)
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
      const clickouts = await getWatchClickouts(c.get('deps'), 'movie', id, watchRegion)
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
      const clickouts = await getWatchClickouts(c.get('deps'), 'tv', id, watchRegion)
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
      const item = await getMediaDetails(c.get('deps'), 'movie', id, watchRegion, language)
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
      const item = await getSeasonDetails(c.get('deps'), id, seasonNumber, language)
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
      const item = await getMediaDetails(c.get('deps'), 'tv', id, watchRegion, language)
      return c.json({ item })
    },
  )
}
