import { zValidator } from '@hono/zod-validator'
import {
  continueConnectorLogin,
  getConnectorLoginAttempt,
  listConnectorProviders,
  startConnectorLogin,
} from '@server/usecases/connector-auth'
import {
  deleteConnector,
  enqueueConnectorSync,
  listConnectorPlaylists,
  listConnectors,
  saveConnectorPlaylistSelection,
  saveDoubanConnector,
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

const connectorAuthInputSchema = z.record(z.string(), z.string()).default({})

const connectorLoginStartSchema = z.object({
  kind: z.string().trim().min(1),
  method: z.string().trim().min(1),
  input: connectorAuthInputSchema,
})

const connectorLoginContinueSchema = z.object({
  action: z.string().trim().min(1),
  input: connectorAuthInputSchema,
})

const playlistSelectionSchema = z.object({
  selectedPlaylistIds: z.array(z.string().uuid()).max(1000),
})

export function registerConnectorRoutes(routes: Hono<AppEnv>) {
  routes.get('/connectors/providers', (c) => {
    return c.json({ items: listConnectorProviders(c.get('deps')) })
  })

  routes.get('/connectors', async (c) => {
    const items = await listConnectors(c.get('deps'), c.get('user').id)
    return c.json({ items })
  })

  routes.post('/connectors/douban', zValidator('json', doubanSchema), async (c) => {
    const item = await saveDoubanConnector(c.get('deps'), c.get('user').id, c.req.valid('json'))
    return c.json({ item })
  })

  routes.post('/connectors/login-attempts', zValidator('json', connectorLoginStartSchema), async (c) => {
    const result = await startConnectorLogin(c.get('deps'), c.env, c.get('user').id, c.req.valid('json'))
    return c.json(result, 201)
  })

  routes.get('/connectors/login-attempts/:id', zValidator('param', idParamsSchema), async (c) => {
    return c.json(await getConnectorLoginAttempt(c.get('deps'), c.get('user').id, c.req.valid('param').id))
  })

  routes.post(
    '/connectors/login-attempts/:id/continue',
    zValidator('param', idParamsSchema),
    zValidator('json', connectorLoginContinueSchema),
    async (c) => {
      return c.json(
        await continueConnectorLogin(
          c.get('deps'),
          c.env,
          c.get('user').id,
          c.req.valid('param').id,
          c.req.valid('json'),
        ),
      )
    },
  )

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
    await enqueueConnectorSync(c.get('deps'), c.get('user').id, c.req.valid('param').id)
    return c.json({ queued: true }, 202)
  })

  routes.get('/connectors/:id/playlists', zValidator('param', idParamsSchema), async (c) => {
    const items = await listConnectorPlaylists(c.get('deps'), c.get('user').id, c.req.valid('param').id)
    return c.json({ items })
  })

  routes.put(
    '/connectors/:id/playlists',
    zValidator('param', idParamsSchema),
    zValidator('json', playlistSelectionSchema),
    async (c) => {
      const result = await saveConnectorPlaylistSelection(
        c.get('deps'),
        c.get('user').id,
        c.req.valid('param').id,
        c.req.valid('json').selectedPlaylistIds,
      )
      return c.json(result, 202)
    },
  )
}
