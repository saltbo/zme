import { Hono } from 'hono'
import { createAuth } from './auth'
import type { Env } from './env'
import { registerBookRoutes } from './http/books'
import type { AppEnv } from './http/context'
import { registerDownloaderRoutes } from './http/downloaders'
import { registerDownloadRoutes } from './http/downloads'
import { registerIndexerRoutes } from './http/indexers'
import { registerLibraryRoutes } from './http/library'
import { registerMediaRoutes } from './http/media'
import { registerMediaSourceRoutes } from './http/media-sources'
import {
  requireAdminExceptIndexerSearchMiddleware,
  requireAdminMiddleware,
  requireAuthMiddleware,
} from './http/middleware'
import { registerMusicRoutes } from './http/music'
import { registerSetupRoutes } from './http/setup'

const routes = new Hono<AppEnv>()

// Registration order is load-bearing: setup routes stay public because they are
// registered before the auth middleware.
registerSetupRoutes(routes)

routes.use('*', requireAuthMiddleware)

routes.use('/indexers/*', requireAdminExceptIndexerSearchMiddleware)
routes.use('/indexers', requireAdminMiddleware)
routes.use('/media-sources', requireAdminMiddleware)
routes.use('/media-sources/*', requireAdminMiddleware)

registerMediaRoutes(routes)
registerBookRoutes(routes)
registerMusicRoutes(routes)
registerIndexerRoutes(routes)
registerLibraryRoutes(routes)
registerMediaSourceRoutes(routes)
registerDownloaderRoutes(routes)
registerDownloadRoutes(routes)

const typedApiApp = new Hono<{ Bindings: Env }>().route('/api', routes)

const app = new Hono<{ Bindings: Env }>()
  .on(['POST', 'GET'], '/api/auth/*', (c) => createAuth(c.env, c.req.raw).handler(c.req.raw))
  .route('/api', routes)

export type AppType = typeof typedApiApp

export { app }
