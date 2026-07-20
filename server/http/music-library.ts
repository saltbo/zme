import { zValidator } from '@hono/zod-validator'
import {
  getFavoriteSongs,
  getMusicCollection,
  listMusicCollections,
  removeMusicCollection,
  saveMusicAlbum,
  setFavoriteSong,
} from '@server/usecases/music-library'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from './context'
import { idParamsSchema } from './schemas'

const collectionQuerySchema = z.object({
  kind: z.enum(['playlist', 'album']),
})

const albumSchema = z.object({
  mediaKey: z.string().trim().min(1),
})

const favoriteTrackSchema = z.object({
  selected: z.boolean(),
  track: z.object({
    provider: z.enum(['netease', 'musicbrainz']),
    externalId: z.string().trim().min(1),
    mediaKey: z.string().trim().min(1),
    title: z.string().trim().min(1),
    artists: z.array(z.string()),
    albumTitle: z.string().nullable(),
    albumExternalId: z.string().nullable(),
    coverUrl: z.string().url().nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    isrcs: z.array(z.string()),
  }),
})

export function registerMusicLibraryRoutes(routes: Hono<AppEnv>) {
  routes.get('/library/music/collections', zValidator('query', collectionQuerySchema), async (c) => {
    const items = await listMusicCollections(c.get('deps'), c.get('user').id, c.req.valid('query').kind)
    return c.json({ items })
  })

  routes.get('/library/music/collections/:id', zValidator('param', idParamsSchema), async (c) => {
    const item = await getMusicCollection(c.get('deps'), c.get('user').id, c.req.valid('param').id)
    if (!item) return c.json({ error: 'Music collection not found.' }, 404)
    return c.json({ item })
  })

  routes.delete('/library/music/collections/:id', zValidator('param', idParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const deleted = await removeMusicCollection(c.get('deps'), c.get('user').id, id)
    if (!deleted) return c.json({ error: 'Music collection not found.' }, 404)
    return c.json({ id })
  })

  routes.post('/library/music/albums', zValidator('json', albumSchema), async (c) => {
    const item = await saveMusicAlbum(c.get('deps'), c.get('user').id, c.req.valid('json').mediaKey)
    return c.json({ item }, 201)
  })

  routes.get('/library/music/favorites', async (c) => {
    const item = await getFavoriteSongs(c.get('deps'), c.get('user').id)
    return c.json({ item })
  })

  routes.put('/library/music/favorites', zValidator('json', favoriteTrackSchema), async (c) => {
    const input = c.req.valid('json')
    const item = await setFavoriteSong(c.get('deps'), c.get('user').id, input.track, input.selected)
    return c.json({ item })
  })
}
