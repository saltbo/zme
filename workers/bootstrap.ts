import { app } from '../server/app'
import { createDb } from '../server/db/client'
import type { Env } from '../server/env'
import { syncEnabledLibrarySources } from '../server/services/library-sources'
import { getActiveTmdbSource } from '../server/services/media-sources'

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, env, ctx)
    }

    return env.ASSETS.fetch(request)
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(syncLibrarySources(env))
  },
}

async function syncLibrarySources(env: Env): Promise<void> {
  const db = createDb(env)
  const tmdb = await getActiveTmdbSource(db)
  await syncEnabledLibrarySources(db, tmdb)
}
