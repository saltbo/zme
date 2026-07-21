import { zValidator } from '@hono/zod-validator'
import {
  beginNeteaseLogin,
  checkNeteaseLogin,
  deleteConnector,
  listConnectorPlaylists,
  listConnectors,
  loginNeteaseWithSms,
  saveDoubanConnector,
  selectConnectorPlaylist,
  sendNeteaseSmsCode,
  syncConnector,
  updateConnector,
} from '@server/usecases/connectors'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from './context'
import { idParamsSchema } from './schemas'

const doubanSchema = z.object({
  profileId: z.string().trim().min(1),
  enabled: z.boolean().default(true),
})

const connectorPatchSchema = z.object({
  enabled: z.boolean(),
})

const loginAttemptParamsSchema = z.object({
  id: z.string().uuid(),
})

const neteaseSmsCodeSchema = z.object({
  countryCode: z
    .string()
    .trim()
    .regex(/^\d{1,4}$/),
  phone: z
    .string()
    .trim()
    .regex(/^\d{5,20}$/),
})

const neteaseSmsLoginSchema = neteaseSmsCodeSchema.extend({
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/),
  verificationAttemptId: z.string().uuid().optional(),
})

const playlistParamsSchema = z.object({
  id: z.string().uuid(),
  playlistId: z.string().uuid(),
})

const playlistSelectionSchema = z.object({
  selected: z.boolean(),
})

export function registerConnectorRoutes(routes: Hono<AppEnv>) {
  routes.get('/connectors', async (c) => {
    const items = await listConnectors(c.get('deps'), c.get('user').id)
    return c.json({ items })
  })

  routes.post('/connectors/douban', zValidator('json', doubanSchema), async (c) => {
    const item = await saveDoubanConnector(c.get('deps'), c.get('user').id, c.req.valid('json'))
    return c.json({ item })
  })

  routes.post('/connectors/netease/login-attempts', async (c) => {
    const item = await beginNeteaseLogin(c.get('deps'), c.env, c.get('user').id)
    return c.json({ item }, 201)
  })

  routes.post(
    '/connectors/netease/login-attempts/:id/check',
    zValidator('param', loginAttemptParamsSchema),
    async (c) => {
      return c.json(await checkNeteaseLogin(c.get('deps'), c.env, c.get('user').id, c.req.valid('param').id))
    },
  )

  routes.post('/connectors/netease/sms-codes', zValidator('json', neteaseSmsCodeSchema), async (c) => {
    await sendNeteaseSmsCode(c.get('deps'), c.req.valid('json'))
    return c.json({ sent: true })
  })

  routes.post('/connectors/netease/sms-login', zValidator('json', neteaseSmsLoginSchema), async (c) => {
    return c.json(await loginNeteaseWithSms(c.get('deps'), c.env, c.get('user').id, c.req.valid('json')))
  })

  routes.patch(
    '/connectors/:id',
    zValidator('param', idParamsSchema),
    zValidator('json', connectorPatchSchema),
    async (c) => {
      const item = await updateConnector(c.get('deps'), c.get('user').id, c.req.valid('param').id, c.req.valid('json'))
      if (!item) return c.json({ error: 'Connector not found.' }, 404)
      return c.json({ item })
    },
  )

  routes.delete('/connectors/:id', zValidator('param', idParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const deleted = await deleteConnector(c.get('deps'), c.get('user').id, id)
    if (!deleted) return c.json({ error: 'Connector not found.' }, 404)
    return c.json({ id })
  })

  routes.post('/connectors/:id/sync', zValidator('param', idParamsSchema), async (c) => {
    const result = await syncConnector(c.get('deps'), c.env, c.get('user').id, c.req.valid('param').id, 'manual')
    return c.json({ result })
  })

  routes.get('/connectors/:id/playlists', zValidator('param', idParamsSchema), async (c) => {
    const items = await listConnectorPlaylists(c.get('deps'), c.get('user').id, c.req.valid('param').id)
    return c.json({ items })
  })

  routes.put(
    '/connectors/:id/playlists/:playlistId',
    zValidator('param', playlistParamsSchema),
    zValidator('json', playlistSelectionSchema),
    async (c) => {
      const params = c.req.valid('param')
      const item = await selectConnectorPlaylist(
        c.get('deps'),
        c.get('user').id,
        params.id,
        params.playlistId,
        c.req.valid('json').selected,
      )
      return c.json({ item })
    },
  )
}
