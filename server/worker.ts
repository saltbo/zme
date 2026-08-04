import { app } from '@server/app'
import { createDeps } from '@server/composition'
import type { Env } from '@server/env'
import {
  type ConnectorSyncMessage,
  processConnectorSyncJob,
  recoverQueuedConnectorSyncJobs,
  syncEnabledConnectors,
} from '@server/usecases/connectors'
import {
  type DownloadDispatchMessage,
  processDownloadDispatch,
  recoverDownloadDispatches,
} from '@server/usecases/download-dispatch'

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
      return app.fetch(request, env, ctx)
    }

    return env.ASSETS.fetch(request)
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(env))
  },
  async queue(batch: MessageBatch<DownloadDispatchMessage | ConnectorSyncMessage>, env: Env): Promise<void> {
    const deps = createDeps(env)
    for (const message of batch.messages) {
      if (isConnectorSyncMessage(message.body)) {
        try {
          const retryAfterSeconds = await processConnectorSyncJob(deps, env, message.body)
          if (retryAfterSeconds) message.retry({ delaySeconds: retryAfterSeconds })
          else message.ack()
        } catch (error) {
          console.error(
            JSON.stringify({
              event: 'connector.sync.job.failed',
              jobId: message.body.jobId,
              errorClass: error instanceof Error ? error.name : 'UnknownError',
            }),
          )
          message.retry({ delaySeconds: 60 })
        }
        continue
      }
      try {
        const result = await processDownloadDispatch(deps, env, message.body)
        if (result.retryAfterSeconds) message.retry({ delaySeconds: result.retryAfterSeconds })
        else message.ack()
      } catch (error) {
        console.error(
          JSON.stringify({
            event: 'download.dispatch.failed',
            laneKey: message.body.laneKey,
            message: error instanceof Error ? error.message : 'Download dispatch failed.',
          }),
        )
        message.retry({ delaySeconds: 60 })
      }
    }
  },
}

async function runScheduled(env: Env): Promise<void> {
  const deps = createDeps(env)
  await recoverQueuedConnectorSyncJobs(deps)
  await syncEnabledConnectors(deps, env)
  await recoverDownloadDispatches(deps)
}

function isConnectorSyncMessage(
  message: DownloadDispatchMessage | ConnectorSyncMessage,
): message is ConnectorSyncMessage {
  return 'type' in message && message.type === 'connector_sync'
}
