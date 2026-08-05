import { zValidator } from '@hono/zod-validator'
import {
  continueConnectorLogin,
  getConnectorLoginAttempt,
  listConnectorProviders,
  startConnectorLogin,
} from '@server/usecases/connector-auth'
import {
  ConnectorNotFoundError,
  ConnectorSyncIdempotencyConflictError,
  ConnectorSyncQueueError,
  deleteConnector,
  enqueueConnectorSync,
  getConnectorSyncJob,
  listConnectorPlaylists,
  listConnectors,
  saveConnectorPlaylistSelection,
  saveDoubanConnector,
  updateConnector,
} from '@server/usecases/connectors'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from './context'
import { entityTag, ifMatchRevision, problem, requireMergePatch } from './protocol'
import { idParamsSchema } from './schemas'

const connectorCreateSchema = z.object({
  kind: z.literal('douban'),
  profileId: z.string().trim().min(1),
  enabled: z.boolean().default(true),
})

const connectorPatchSchema = z
  .object({ enabled: z.boolean().optional() })
  .refine((value) => value.enabled !== undefined)

const connectorAuthInputSchema = z.record(z.string(), z.string()).default({})

const connectorLoginStartSchema = z.object({
  kind: z.string().trim().min(1),
  method: z.string().trim().min(1),
  input: connectorAuthInputSchema,
})

const connectorLoginContinueSchema = z.object({
  challenge: z.string().trim().min(1),
  input: connectorAuthInputSchema,
})

const connectorSyncJobSchema = z.object({
  connectorId: z.string().trim().min(1),
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

  routes.post('/connectors', zValidator('json', connectorCreateSchema), async (c) => {
    const item = await saveDoubanConnector(c.get('deps'), c.get('user').id, c.req.valid('json'))
    c.header('Location', `/api/connectors/${item.id}`)
    return c.json({ item }, 201)
  })

  routes.post('/connector-login-attempts', zValidator('json', connectorLoginStartSchema), async (c) => {
    const result = await startConnectorLogin(c.get('deps'), c.env, c.get('user').id, c.req.valid('json'))
    c.header('Location', `/api/connector-login-attempts/${result.attempt.id}`)
    return c.json(result, 201)
  })

  routes.get('/connector-login-attempts/:id', zValidator('param', idParamsSchema), async (c) => {
    return c.json(await getConnectorLoginAttempt(c.get('deps'), c.get('user').id, c.req.valid('param').id))
  })

  routes.put(
    '/connector-login-attempts/:id/response',
    zValidator('param', idParamsSchema),
    zValidator('json', connectorLoginContinueSchema),
    async (c) => {
      return c.json(
        await continueConnectorLogin(c.get('deps'), c.env, c.get('user').id, c.req.valid('param').id, {
          action: c.req.valid('json').challenge,
          input: c.req.valid('json').input,
        }),
      )
    },
  )

  routes.patch(
    '/connectors/:id',
    zValidator('param', idParamsSchema),
    zValidator('json', connectorPatchSchema),
    async (c) => {
      const unsupported = requireMergePatch(c)
      if (unsupported) return unsupported
      const expectedUpdatedAt = ifMatchRevision(c)
      if (!expectedUpdatedAt) return problem(c, 428, 'precondition-required', 'If-Match is required')
      const item = await updateConnector(
        c.get('deps'),
        c.get('user').id,
        c.req.valid('param').id,
        c.req.valid('json'),
        expectedUpdatedAt,
      )
      if (!item) return c.json({ error: 'Connector not found.' }, 404)
      c.header('ETag', entityTag(item.updatedAt))
      return c.json({ item })
    },
  )

  routes.delete('/connectors/:id', zValidator('param', idParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const expectedUpdatedAt = ifMatchRevision(c)
    if (!expectedUpdatedAt) return problem(c, 428, 'precondition-required', 'If-Match is required')
    const deleted = await deleteConnector(c.get('deps'), c.get('user').id, id, expectedUpdatedAt)
    if (!deleted) return c.json({ error: 'Connector not found.' }, 404)
    return c.body(null, 204)
  })

  routes.post('/connector-sync-jobs', zValidator('json', connectorSyncJobSchema), async (c) => {
    const key = c.req.header('Idempotency-Key')?.trim()
    if (!key || key.length > 200) return problem(c, 400, 'idempotency-key-required', 'Idempotency-Key is required')
    try {
      const job = await enqueueConnectorSync(c.get('deps'), c.get('user').id, c.req.valid('json').connectorId, key)
      c.header('Location', `/api/connector-sync-jobs/${job.id}`)
      return c.json({ job }, 201)
    } catch (error) {
      if (error instanceof ConnectorNotFoundError) return problem(c, 404, 'connector-not-found', 'Connector not found')
      if (error instanceof ConnectorSyncIdempotencyConflictError)
        return problem(c, 409, 'idempotency-conflict', 'Idempotency-Key was reused with different content')
      if (error instanceof ConnectorSyncQueueError)
        return problem(c, 503, 'connector-sync-unavailable', 'Connector synchronization is temporarily unavailable')
      throw error
    }
  })

  routes.get('/connector-sync-jobs/:id', zValidator('param', idParamsSchema), async (c) => {
    const job = await getConnectorSyncJob(c.get('deps'), c.get('user').id, c.req.valid('param').id)
    if (!job) return problem(c, 404, 'connector-sync-job-not-found', 'Connector sync job not found')
    return c.json({ job })
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
