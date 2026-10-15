import { readConfig } from '@server/config'
import { Hono, type MiddlewareHandler } from 'hono'
import { createDeps } from './composition'
import { registerBookRoutes } from './http/books'
import { registerChartRoutes } from './http/charts'
import { registerConnectorRoutes } from './http/connectors'
import type { AppEnv } from './http/context'
import { registerDownloaderRoutes } from './http/downloaders'
import { registerDownloadRoutes } from './http/downloads'
import { registerIdentityRoutes } from './http/identity'
import { registerIndexerRoutes } from './http/indexers'
import { registerLibraryRoutes } from './http/library'
import { registerPublicLocalDownloadRoutes } from './http/local-downloads'
import { registerMediaRoutes } from './http/media'
import { registerMediaSourceRoutes } from './http/media-sources'
import { requireAdminMiddleware, requireAuthMiddleware } from './http/middleware'
import { registerMusicRoutes } from './http/music'
import { registerPublicMusicDownloadRoutes } from './http/music-downloads'
import { registerMusicLibraryRoutes } from './http/music-library'
import { logRequestFailure, normalizeProblemMiddleware, problem, requestBoundaryMiddleware } from './http/protocol'
import { registerPublicContractRoutes, registerResourceApiRoutes } from './http/resource-api'
import { PROTECTED_RESOURCE_METADATA_PATH, protectedResourceMetadata } from './http/resource-authorization'
import { registerTorrentRoutes } from './http/torrents'
import { StaleWriteError } from './usecases/ports'
import {
  ResourceConflictError,
  ResourceNotFoundError,
  ResourceUnavailableError,
  ResourceUpstreamError,
} from './usecases/resource-errors'

const app = new Hono<AppEnv>()

app.use('*', requestBoundaryMiddleware)
app.use('*', normalizeProblemMiddleware)
const withDependencies: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('deps', createDeps(c.env, c.get('trace')))
  await next()
}
app.use('/auth/*', withDependencies)
registerIdentityRoutes(app)
app.get(PROTECTED_RESOURCE_METADATA_PATH, (c) => c.json(protectedResourceMetadata(readConfig(c.env))))

const routes = new Hono<AppEnv>()
routes.get('/', (c) => c.json({ resource: c.req.url, openapi: `${new URL(c.req.url).origin}/api/openapi.json` }))
routes.get('/health', (c) => c.json({ ok: true, name: 'zme' }))
registerPublicContractRoutes(routes)
routes.use('*', withDependencies)
registerPublicMusicDownloadRoutes(routes)
registerPublicLocalDownloadRoutes(routes)
routes.use('*', requireAuthMiddleware)
routes.use('/indexers/*', requireAdminMiddleware)
routes.use('/indexers', requireAdminMiddleware)
routes.use('/media-sources', requireAdminMiddleware)
routes.use('/media-sources/*', requireAdminMiddleware)
const catalog = new Hono<AppEnv>()
registerResourceApiRoutes(catalog)
registerMediaRoutes(catalog)
registerBookRoutes(catalog)
registerMusicRoutes(catalog)
routes.route('/catalog', catalog)
registerChartRoutes(routes)
registerMusicLibraryRoutes(routes)
registerConnectorRoutes(routes)
registerIndexerRoutes(routes)
registerTorrentRoutes(routes)
registerLibraryRoutes(routes)
registerMediaSourceRoutes(routes)
registerDownloaderRoutes(routes)
registerDownloadRoutes(routes)

app.route('/api', routes)
app.notFound((c) => problem(c, 404, 'not-found', 'Resource not found'))
app.onError((error, c) => {
  if (error instanceof ResourceNotFoundError) return problem(c, 404, 'not-found', error.message)
  if (error instanceof ResourceConflictError) return problem(c, 409, 'resource-conflict', error.message)
  if (error instanceof ResourceUnavailableError) return problem(c, 503, 'resource-unavailable', error.message)
  if (error instanceof ResourceUpstreamError)
    return problem(c, 502, 'upstream-unavailable', 'The upstream service is unavailable')
  const status = error instanceof StaleWriteError ? 412 : 500
  logRequestFailure(error, c, status)
  if (error instanceof StaleWriteError) {
    return problem(c, 412, 'precondition-failed', 'Precondition failed', error.message)
  }
  return problem(c, 500, 'internal-error', 'The request could not be completed')
})

export type AppType = typeof app
export { app }
