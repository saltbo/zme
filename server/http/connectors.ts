import { zValidator } from '@hono/zod-validator'
import {
  getConnectorChallengeResponse,
  getConnectorLoginAttempt,
  listConnectorProviders,
  startConnectorLogin,
  submitConnectorChallengeResponse,
} from '@server/usecases/connector-auth'
import {
  ConnectorNotFoundError,
  ConnectorSyncIdempotencyConflictError,
  ConnectorSyncQueueError,
  deleteConnector,
  enqueueConnectorSync,
  getConnectorPlaylistSelection,
  getConnectorSyncJob,
  listConnectorPlaylists,
  listConnectors,
  saveConnectorPlaylistSelection,
  saveDoubanConnector,
  updateConnector,
} from '@server/usecases/connectors'
import { ResourceConflictError, ResourceNotFoundError } from '@server/usecases/resource-errors'
import type { ConnectorLoginResult } from '@shared/types'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from './context'
import { problem, requireMergePatch } from './protocol'
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

const connectorLoginContinueSchema = z
  .object({
    input: connectorAuthInputSchema,
  })
  .strict()

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
    return c.json(item, 201)
  })

  routes.post('/connector-login-attempts', zValidator('json', connectorLoginStartSchema), async (c) => {
    const result = await startConnectorLogin(c.get('deps'), c.env, c.get('user').id, c.req.valid('json'))
    c.header('Location', `/api/connector-login-attempts/${result.attempt.id}`)
    return c.json(loginAttemptRepresentation(c, result), 201)
  })

  routes.get('/connector-login-attempts/:id', zValidator('param', idParamsSchema), async (c) => {
    return c.json(
      loginAttemptRepresentation(
        c,
        await getConnectorLoginAttempt(c.get('deps'), c.get('user').id, c.req.valid('param').id),
      ),
    )
  })

  routes.put(
    '/connector-login-attempts/:id/challenge-response',
    zValidator('param', idParamsSchema),
    zValidator('json', connectorLoginContinueSchema),
    async (c) => {
      try {
        const result = await submitConnectorChallengeResponse(
          c.get('deps'),
          c.env,
          c.get('user').id,
          c.req.valid('param').id,
          c.req.valid('json').input,
        )
        const self = new URL(c.req.url).toString()
        c.header('Location', self)
        return c.json(
          { ...result.response, links: { self, attempt: self.replace(/\/challenge-response$/, '') } },
          result.created ? 201 : 200,
        )
      } catch (error) {
        if (error instanceof ResourceConflictError) return problem(c, 409, 'challenge-response-conflict', error.message)
        if (error instanceof ResourceNotFoundError) return problem(c, 404, 'not-found', error.message)
        throw error
      }
    },
  )

  routes.get('/connector-login-attempts/:id/challenge-response', zValidator('param', idParamsSchema), async (c) => {
    try {
      const response = await getConnectorChallengeResponse(c.get('deps'), c.get('user').id, c.req.valid('param').id)
      const self = new URL(c.req.url).toString()
      return c.json({ ...response, links: { self, attempt: self.replace(/\/challenge-response$/, '') } })
    } catch (error) {
      if (error instanceof ResourceNotFoundError) return problem(c, 404, 'not-found', error.message)
      throw error
    }
  })

  routes.patch(
    '/connectors/:id',
    zValidator('param', idParamsSchema),
    zValidator('json', connectorPatchSchema),
    async (c) => {
      const unsupported = requireMergePatch(c)
      if (unsupported) return unsupported
      const item = await updateConnector(c.get('deps'), c.get('user').id, c.req.valid('param').id, c.req.valid('json'))
      if (!item) return c.json({ error: 'Connector not found.' }, 404)
      return c.json(item)
    },
  )

  routes.delete('/connectors/:id', zValidator('param', idParamsSchema), async (c) => {
    const { id } = c.req.valid('param')
    const deleted = await deleteConnector(c.get('deps'), c.get('user').id, id)
    if (!deleted) return c.json({ error: 'Connector not found.' }, 404)
    return c.body(null, 204)
  })

  routes.post('/connector-sync-jobs', zValidator('json', connectorSyncJobSchema), async (c) => {
    const key = c.req.header('Idempotency-Key')?.trim()
    if (!key || key.length > 200) return problem(c, 400, 'idempotency-key-required', 'Idempotency-Key is required')
    try {
      const job = await enqueueConnectorSync(c.get('deps'), c.get('user').id, c.req.valid('json').connectorId, key)
      c.header('Location', `/api/connector-sync-jobs/${job.id}`)
      return c.json(job, 201)
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
    return c.json(job)
  })

  routes.get('/connectors/:id/playlists', zValidator('param', idParamsSchema), async (c) => {
    const items = await listConnectorPlaylists(c.get('deps'), c.get('user').id, c.req.valid('param').id)
    return c.json({ items })
  })

  routes.put(
    '/connectors/:id/playlist-selection',
    zValidator('param', idParamsSchema),
    zValidator('json', playlistSelectionSchema),
    async (c) => {
      const result = await saveConnectorPlaylistSelection(
        c.get('deps'),
        c.get('user').id,
        c.req.valid('param').id,
        c.req.valid('json').selectedPlaylistIds,
      )
      return c.json({
        selectedPlaylistIds: result.selectedPlaylistIds,
        links: {
          self: new URL(`/api/connectors/${c.req.valid('param').id}/playlist-selection`, c.req.url).toString(),
          syncJob: new URL(`/api/connector-sync-jobs/${result.syncJob.id}`, c.req.url).toString(),
        },
      })
    },
  )

  routes.get('/connectors/:id/playlist-selection', zValidator('param', idParamsSchema), async (c) => {
    try {
      const selection = await getConnectorPlaylistSelection(c.get('deps'), c.get('user').id, c.req.valid('param').id)
      return c.json({ ...selection, links: { self: new URL(c.req.url).toString() } })
    } catch (error) {
      if (error instanceof ResourceNotFoundError) return problem(c, 404, 'not-found', error.message)
      throw error
    }
  })
}

function loginAttemptRepresentation(c: Context<AppEnv>, result: ConnectorLoginResult) {
  const self = new URL(`/api/connector-login-attempts/${result.attempt.id}`, c.req.url).toString()
  return {
    ...result.attempt,
    connector: result.connector,
    links: { self, challengeResponse: `${self}/challenge-response` },
  }
}
