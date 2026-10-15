import { zValidator } from '@hono/zod-validator'
import {
  discoverMedia,
  getMediaDetails,
  getPersonCredits,
  getSeasonDetails,
  getWatchClickouts,
  listMediaGenres,
} from '@server/usecases/media'
import { getActiveTmdbSource } from '@server/usecases/media-sources'
import type { Hono } from 'hono'
import { z } from 'zod'
import { catalogHref, catalogItem, catalogPage } from './catalog-representations'
import type { AppEnv } from './context'
import { problem } from './protocol'

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

const genreQuerySchema = z.object({
  mediaType: z.enum(['movie', 'series']),
  language: z.string().trim().min(2).optional(),
})

const catalogQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(200).optional(),
    language: z.string().trim().min(2).optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce
      .number()
      .int()
      .refine((value) => value === 20, 'Page size must be 20')
      .default(20),
    orderBy: z.enum(['popularity desc', 'rating desc', 'releaseDate desc']).optional(),
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
      .max(new Date().getUTCFullYear() + 2)
      .optional(),
    ratingGte: z.coerce.number().min(0).max(10).optional(),
  })
  .strict()

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
  for (const [collection, kind] of [
    ['movies', 'movie'],
    ['series', 'tv'],
  ] as const) {
    routes.get(`/${collection}`, zValidator('query', catalogQuerySchema), async (c) => {
      const { q, orderBy, pageSize, ...input } = c.req.valid('query')
      if (
        q &&
        [orderBy, input.genreId, input.originCountry, input.year, input.ratingGte].some((value) => value !== undefined)
      ) {
        return problem(c, 422, 'validation-error', 'Keyword search cannot be combined with browse filters')
      }
      if (q) {
        const source = await getActiveTmdbSource(c.get('deps'), input.language)
        return c.json(
          catalogPage(
            c,
            await c.get('deps').mediaProvider.searchPage(source, { query: q, page: input.page, kind }),
            pageSize,
          ),
        )
      }
      const sorts = {
        'popularity desc': 'popularity.desc',
        'rating desc': 'vote_average.desc',
        'releaseDate desc': kind === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc',
      } as const
      const result = await discoverMedia(c.get('deps'), { ...input, kind, sortBy: sorts[orderBy ?? 'popularity desc'] })
      return c.json(catalogPage(c, result, pageSize))
    })
  }

  routes.get('/genres', zValidator('query', genreQuerySchema), async (c) => {
    const { mediaType, language } = c.req.valid('query')
    const genres = await listMediaGenres(c.get('deps'), mediaType === 'movie' ? 'movie' : 'tv', language)
    return c.json({ items: genres })
  })

  routes.get(
    '/people/:id',
    zValidator('param', personParamsSchema),
    zValidator('query', languageQuerySchema),
    async (c) => {
      const { person } = await getPersonCredits(c.get('deps'), c.req.valid('param').id, c.req.valid('query').language)
      const self = catalogHref(c, `/people/${person.id}`)
      return c.json({ ...person, links: { self, credits: `${self}/credits` } })
    },
  )

  routes.get(
    '/people/:id/credits',
    zValidator('param', personParamsSchema),
    zValidator('query', languageQuerySchema),
    async (c) => {
      const { id } = c.req.valid('param')
      const { language } = c.req.valid('query')
      const credits = await getPersonCredits(c.get('deps'), id, language)
      return c.json({ items: credits.results.map((item) => ({ kind: 'cast' as const, media: catalogItem(c, item) })) })
    },
  )

  routes.get(
    '/movies/:id/watch-links',
    zValidator('param', mediaIdParamsSchema),
    zValidator('query', mediaDetailQuerySchema),
    async (c) => {
      const { id } = c.req.valid('param')
      const { watchRegion } = c.req.valid('query')
      const clickouts = await getWatchClickouts(c.get('deps'), 'movie', id, watchRegion)
      return c.json({ items: Object.entries(clickouts).map(([provider, href]) => ({ provider, href })) })
    },
  )

  routes.get(
    '/series/:id/watch-links',
    zValidator('param', mediaIdParamsSchema),
    zValidator('query', mediaDetailQuerySchema),
    async (c) => {
      const { id } = c.req.valid('param')
      const { watchRegion } = c.req.valid('query')
      const clickouts = await getWatchClickouts(c.get('deps'), 'tv', id, watchRegion)
      return c.json({ items: Object.entries(clickouts).map(([provider, href]) => ({ provider, href })) })
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
      return c.json(catalogItem(c, item))
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
      const self = catalogHref(c, `/series/${id}/seasons/${seasonNumber}`)
      return c.json({ ...item, links: { self, series: catalogHref(c, `/series/${id}`), episodes: `${self}/episodes` } })
    },
  )

  routes.get(
    '/series/:id/seasons',
    zValidator('param', mediaIdParamsSchema),
    zValidator('query', languageQuerySchema),
    async (c) => {
      const id = c.req.valid('param').id
      const series = await getMediaDetails(c.get('deps'), 'tv', id, 'US', c.req.valid('query').language)
      return c.json({
        items: series.seasons.map((season) => ({
          ...season,
          links: { self: catalogHref(c, `/series/${id}/seasons/${season.seasonNumber}`) },
        })),
      })
    },
  )

  routes.get(
    '/series/:id/seasons/:seasonNumber/episodes',
    zValidator('param', seasonParamsSchema),
    zValidator('query', languageQuerySchema),
    async (c) => {
      const { id, seasonNumber } = c.req.valid('param')
      const season = await getSeasonDetails(c.get('deps'), id, seasonNumber, c.req.valid('query').language)
      return c.json({
        items: season.episodes.map((episode) => ({
          ...episode,
          links: { self: catalogHref(c, `/series/${id}/seasons/${seasonNumber}/episodes/${episode.episodeNumber}`) },
        })),
      })
    },
  )

  routes.get(
    '/series/:id/seasons/:seasonNumber/episodes/:episodeNumber',
    zValidator('param', seasonParamsSchema.extend({ episodeNumber: z.coerce.number().int().positive() })),
    zValidator('query', languageQuerySchema),
    async (c) => {
      const { id, seasonNumber, episodeNumber } = c.req.valid('param')
      const season = await getSeasonDetails(c.get('deps'), id, seasonNumber, c.req.valid('query').language)
      const episode = season.episodes.find((item) => item.episodeNumber === episodeNumber)
      if (!episode) return problem(c, 404, 'not-found', 'Episode not found')
      return c.json({
        ...episode,
        links: {
          self: catalogHref(c, `/series/${id}/seasons/${seasonNumber}/episodes/${episodeNumber}`),
          season: catalogHref(c, `/series/${id}/seasons/${seasonNumber}`),
        },
      })
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
      return c.json(catalogItem(c, item))
    },
  )
}
