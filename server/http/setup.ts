import { zValidator } from '@hono/zod-validator'
import type { Hono } from 'hono'
import { z } from 'zod'
import { createAuth } from '../auth'
import { createDb } from '../db/client'
import { createInitialAdmin, isInitialized } from '../services/setup'
import type { AppEnv } from './context'

const setupAdminSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  password: z.string().min(8),
})

export function registerSetupRoutes(routes: Hono<AppEnv>) {
  routes.get('/health', (c) =>
    c.json({
      ok: true,
      name: 'zme',
    }),
  )

  routes.get('/setup/status', async (c) => {
    const initialized = await isInitialized(createDb(c.env))
    return c.json({ initialized })
  })

  routes.post('/setup/admin', zValidator('json', setupAdminSchema), async (c) => {
    try {
      const user = await createInitialAdmin(createDb(c.env), createAuth(c.env, c.req.raw), c.req.valid('json'))
      return c.json({ user }, 201)
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Setup failed.' }, 409)
    }
  })
}
