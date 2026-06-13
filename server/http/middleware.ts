import type { MiddlewareHandler } from 'hono'
import { type AuthUser, createAuth } from '../auth'
import type { AppEnv } from './context'

export const requireAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await createAuth(c.env, c.req.raw).api.getSession({ headers: c.req.raw.headers })
  if (!session) {
    return c.json({ error: 'Authentication required.' }, 401)
  }

  c.set('user', session.user)
  c.set('session', session.session)
  await next()
}

export const requireAdminMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isAdmin(c.get('user'))) {
    return c.json({ error: 'Administrator access required.' }, 403)
  }
  await next()
}

export const requireAdminExceptIndexerSearchMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.path.endsWith('/indexers/search')) {
    await next()
    return
  }
  return requireAdminMiddleware(c, next)
}

function isAdmin(user: AuthUser): boolean {
  return (user.role || '').split(',').includes('admin')
}
