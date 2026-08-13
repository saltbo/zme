import { readConfig } from '@server/config'
import { Hono } from 'hono'
import { createDeps } from './composition'
import { registerBookRoutes } from './http/books'
import { registerConnectorRoutes } from './http/connectors'
import type { AppEnv } from './http/context'
import { registerDownloaderRoutes } from './http/downloaders'
import { registerDownloadRoutes } from './http/downloads'
import { registerIdentityRoutes } from './http/identity'
import { registerIndexerRoutes } from './http/indexers'
import { registerLibraryRoutes } from './http/library'
import { registerMediaRoutes } from './http/media'
import { registerMediaSourceRoutes } from './http/media-sources'
import { requireAdminMiddleware, requireAuthMiddleware } from './http/middleware'
import { registerMusicRoutes } from './http/music'
import { registerPublicMusicDownloadRoutes } from './http/music-downloads'
import { registerMusicLibraryRoutes } from './http/music-library'
import { normalizeProblemMiddleware, problem, requestBoundaryMiddleware } from './http/protocol'
import { registerPublicContractRoutes, registerResourceApiRoutes } from './http/resource-api'
import { PROTECTED_RESOURCE_METADATA_PATH, protectedResourceMetadata } from './http/resource-authorization'
import { StaleWriteError } from './usecases/ports'

const app = new Hono<AppEnv>()

app.use('*', requestBoundaryMiddleware)
app.use('*', normalizeProblemMiddleware)
app.use('*', async (c, next) => {
  c.set('deps', createDeps(c.env, c.get('trace')))
  await next()
})
registerIdentityRoutes(app)
app.get(PROTECTED_RESOURCE_METADATA_PATH, (c) => c.json(protectedResourceMetadata(readConfig(c.env))))

const routes = new Hono<AppEnv>()
routes.get('/', (c) => c.json({ resource: c.req.url, openapi: `${new URL(c.req.url).origin}/api/openapi.json` }))
routes.get('/health', (c) => c.json({ ok: true, name: 'zme' }))
registerPublicContractRoutes(routes)
registerPublicMusicDownloadRoutes(routes)
routes.use('*', requireAuthMiddleware)
routes.use('/indexers/*', requireAdminMiddleware)
routes.use('/indexers', requireAdminMiddleware)
routes.use('/media-sources', requireAdminMiddleware)
routes.use('/media-sources/*', requireAdminMiddleware)
registerResourceApiRoutes(routes)
registerMediaRoutes(routes)
registerBookRoutes(routes)
registerMusicRoutes(routes)
registerMusicLibraryRoutes(routes)
registerConnectorRoutes(routes)
registerIndexerRoutes(routes)
registerLibraryRoutes(routes)
registerMediaSourceRoutes(routes)
registerDownloaderRoutes(routes)
registerDownloadRoutes(routes)

app.route('/api', routes)
app.notFound((c) => problem(c, 404, 'not-found', 'Resource not found'))
app.onError((error, c) => {
  console.error(JSON.stringify({ event: 'http.request.failed', errorClass: error.name, requestId: c.get('requestId') }))
  if (error instanceof StaleWriteError) {
    return problem(c, 412, 'precondition-failed', 'Precondition failed', error.message)
  }
  return problem(c, 500, 'internal-error', 'The request could not be completed')
})

export type AppType = typeof app
export { app }
