import { zValidator } from '@hono/zod-validator'
import {
  deleteLibraryState,
  listLibrary,
  listLibraryStates,
  saveLibraryState,
  setWatchedState,
} from '@server/usecases/library'
import type { LibraryRecord } from '@server/usecases/ports'
import { getMediaKeyLibraryKind } from '@shared/media-key'
import type { Hono } from 'hono'
import { z } from 'zod'
import { mediaKeyParamsSchema } from './books'
import type { AppEnv } from './context'
import { pageRepresentation, setPageLinks } from './protocol'

const libraryQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(36),
  language: z.string().trim().min(2).optional(),
  kind: z.enum(['all', 'movie', 'tv', 'music', 'book']).default('all'),
  status: z.enum(['all', 'unwatched', 'watched']).default('all'),
})

const libraryResourceStateSchema = z.object({
  status: z.enum(['saved', 'watched']).default('saved'),
})
export function registerLibraryRoutes(routes: Hono<AppEnv>) {
  routes.get('/library/items', zValidator('query', libraryQuerySchema), async (c) => {
    const page = await listLibrary(c.get('deps'), c.get('user').id, c.req.valid('query'))
    setPageLinks(c, c.req.valid('query'), page.totalResults)
    return c.json(pageRepresentation(page.items, page.page, page.pageSize, page.totalResults, page.totalPages))
  })

  routes.get('/library/states', async (c) => {
    const items = await listLibraryStates(c.get('deps'), c.get('user').id)
    return c.json({ items })
  })

  routes.put(
    '/library/items/:mediaKey',
    zValidator('param', mediaKeyParamsSchema),
    zValidator('json', libraryResourceStateSchema),
    async (c) => {
      const mediaKey = decodeRouteMediaKey(c.req.valid('param').mediaKey)
      const kind = getMediaKeyLibraryKind(mediaKey)
      if (!kind) return c.json({ error: 'Library media key is invalid.' }, 422)
      const input = { mediaKey, kind, ...c.req.valid('json') }
      const deps = c.get('deps')
      const userId = c.get('user').id
      const row =
        input.status === 'watched'
          ? await setWatchedState(deps, userId, input, true)
          : ((await setWatchedState(deps, userId, input, false)) ?? (await saveLibraryState(deps, userId, input)))

      if (!row) return c.json({ error: 'Library item not found.' }, 404)

      return c.json(toLibraryStateResponse(row))
    },
  )

  routes.delete('/library/items/:mediaKey', zValidator('param', mediaKeyParamsSchema), async (c) => {
    const mediaKey = decodeRouteMediaKey(c.req.valid('param').mediaKey)
    const kind = getMediaKeyLibraryKind(mediaKey)
    if (!kind) return c.json({ error: 'Library media key is invalid.' }, 422)

    const deleted = await deleteLibraryState(c.get('deps'), c.get('user').id, { mediaKey, kind })
    if (!deleted) return c.json({ error: 'Library item not found.' }, 404)
    return c.json({ mediaKey, kind })
  })
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
