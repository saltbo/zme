import { app } from '../server/app'
import { createDeps } from '../server/composition'
import type { Env } from '../server/env'
import { syncEnabledLibrarySources } from '../server/usecases/library-sources'

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, env, ctx)
    }

    return env.ASSETS.fetch(request)
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(syncEnabledLibrarySources(createDeps(env)))
  },
}
