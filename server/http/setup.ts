import { zValidator } from '@hono/zod-validator'
import { createAuth } from '@server/auth'
import { createInitialAdmin, isInitialized } from '@server/usecases/setup'
import type { Hono } from 'hono'
import { z } from 'zod'
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
    const initialized = await isInitialized(c.get('deps'))
    return c.json({ initialized })
  })

  routes.post('/setup/admin', zValidator('json', setupAdminSchema), async (c) => {
    const auth = createAuth(c.env, c.req.raw)
    try {
      const user = await createInitialAdmin(
        c.get('deps'),
        async (input) => (await auth.api.createUser({ body: input })).user,
        c.req.valid('json'),
      )
      return c.json({ user }, 201)
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Setup failed.' }, 409)
    }
  })
}
