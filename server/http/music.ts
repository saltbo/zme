import { zValidator } from '@hono/zod-validator'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import { discoverMusicAlbums, getMusicAlbumDetails, MusicProviderError, searchMusicAlbums } from '../adapters/providers/music'
import type { AppEnv } from './context'

const musicSearchQuerySchema = z
  .object({
    q: z.string().trim().min(1).optional(),
    artist: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(60).default(20),
  })
  .refine((value) => value.q || value.artist || value.title, {
    message: 'At least one music search field is required.',
  })

const musicDetailsQuerySchema = z.object({
  mediaKey: z.string().trim().min(1),
})

const musicDiscoverQuerySchema = z.object({
  mode: z.enum(['popular', 'genre']).default('popular'),
  range: z.enum(['week', 'month', 'year', 'all_time']).default('all_time'),
  chartType: z.enum(['albums', 'tracks']).default('albums'),
  genre: z.enum(['rock', 'jazz', 'electronic', 'hip-hop', 'classical', 'pop', 'metal']).optional(),
  releaseType: z.enum(['album', 'ep', 'single']).default('album'),
  year: z
    .string()
    .trim()
    .regex(/^(19|20)\d{2}$/)
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(20),
})

export function registerMusicRoutes(routes: Hono<AppEnv>) {
  routes.get('/music/search', zValidator('query', musicSearchQuerySchema), async (c) => {
    try {
      return c.json(await searchMusicAlbums(c.req.valid('query')))
    } catch (error) {
      return musicProviderErrorResponse(c, error)
    }
  })

  routes.get('/music/discover', zValidator('query', musicDiscoverQuerySchema), async (c) => {
    try {
      return c.json(await discoverMusicAlbums(c.req.valid('query')))
    } catch (error) {
      return musicProviderErrorResponse(c, error)
    }
  })

  routes.get('/music/details', zValidator('query', musicDetailsQuerySchema), async (c) => {
    try {
      const item = await getMusicAlbumDetails(c.req.valid('query').mediaKey)
      return c.json({ item })
    } catch (error) {
      return musicProviderErrorResponse(c, error)
    }
  })
}

function musicProviderErrorResponse(c: Context<AppEnv>, error: unknown) {
  if (error instanceof MusicProviderError) {
    return c.json({ code: error.code, error: error.message }, error.status as 400 | 404 | 429 | 502)
  }

  return c.json(
    {
      code: 'MUSIC_PROVIDER_FAILED',
      error: error instanceof Error ? error.message : 'Music provider request failed.',
    },
    502,
  )
}
