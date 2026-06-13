import { zValidator } from '@hono/zod-validator'
import type { Hono } from 'hono'
import { z } from 'zod'
import {
  deleteLibraryState,
  listLibrary,
  listLibraryStates,
  saveLibraryState,
  setWatchedState,
} from '../usecases/library'
import {
  deleteLibrarySource,
  listLibrarySources,
  saveLibrarySource,
  syncLibrarySource,
} from '../usecases/library-sources'
import type { LibraryRecord } from '../usecases/ports'
import { mediaKeyParamsSchema } from './books'
import type { AppEnv } from './context'

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

const librarySourceSchema = z.object({
  profileId: z.string().trim().min(1),
  enabled: z.boolean(),
})

const libraryResourceSchema = z.object({
  mediaKey: z.string().trim().min(1),
  kind: z.enum(['movie', 'tv', 'music', 'book']),
  status: z.enum(['saved', 'watched']).default('saved'),
})

export function registerLibraryRoutes(routes: Hono<AppEnv>) {
  routes.get('/library', zValidator('query', libraryQuerySchema), async (c) => {
    return c.json(await listLibrary(c.get('deps'), c.get('user').id, c.req.valid('query')))
  })

  routes.get('/library/states', async (c) => {
    const items = await listLibraryStates(c.get('deps'), c.get('user').id)
    return c.json({ items })
  })

  routes.get('/library/sources', async (c) => {
    const items = await listLibrarySources(c.get('deps'), c.get('user').id)
    return c.json({ items })
  })

  routes.put(
    '/library/sources/:source',
    zValidator('param', librarySourceParamsSchema),
    zValidator('json', librarySourceSchema),
    async (c) => {
      const { source } = c.req.valid('param')
      const item = await saveLibrarySource(c.get('deps'), c.get('user').id, source, c.req.valid('json'))
      return c.json({ item })
    },
  )

  routes.delete('/library/sources/:source', zValidator('param', librarySourceParamsSchema), async (c) => {
    const { source } = c.req.valid('param')
    const deleted = await deleteLibrarySource(c.get('deps'), c.get('user').id, source)
    if (!deleted) return c.json({ error: 'Library source not found.' }, 404)
    return c.json({ source })
  })

  routes.post('/library/sources/:source/sync', zValidator('param', librarySourceParamsSchema), async (c) => {
    const result = await syncLibrarySource(c.get('deps'), c.get('user').id, c.req.valid('param').source)
    return c.json({ result })
  })

  routes.put('/library/resources', zValidator('json', libraryResourceSchema), async (c) => {
    const input = c.req.valid('json')
    const deps = c.get('deps')
    const userId = c.get('user').id
    const row =
      input.status === 'watched'
        ? await setWatchedState(deps, userId, input, true)
        : ((await setWatchedState(deps, userId, input, false)) ?? (await saveLibraryState(deps, userId, input)))

    if (!row) return c.json({ error: 'Library item not found.' }, 404)

    return c.json({ item: toLibraryStateResponse(row) })
  })

  routes.delete(
    '/library/resources/:mediaKey',
    zValidator('param', mediaKeyParamsSchema),
    zValidator('json', libraryResourceSchema),
    async (c) => {
      const mediaKey = decodeRouteMediaKey(c.req.valid('param').mediaKey)
      const input = c.req.valid('json')
      if (input.mediaKey !== mediaKey) return c.json({ error: 'Library route does not match request body.' }, 400)

      const deleted = await deleteLibraryState(c.get('deps'), c.get('user').id, input)
      if (!deleted) return c.json({ error: 'Library item not found.' }, 404)
      return c.json({ mediaKey, kind: input.kind })
    },
  )
}

function decodeRouteMediaKey(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function toLibraryStateResponse(row: LibraryRecord) {
  return {
    mediaKey: row.mediaKey,
    id: row.tmdbId,
    kind: row.kind,
    savedAt: row.savedAt,
    watchedAt: row.watchedAt,
    updatedAt: row.updatedAt,
  }
}
