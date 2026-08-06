import { app } from '@server/app'
import { createDeps } from '@server/composition'
import type { Env } from '@server/env'
import { PROTECTED_RESOURCE_METADATA_PATH } from '@server/http/resource-authorization'
import { continueTrace } from '@server/observability/trace'
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
import {
  type DownloadReconciliationMessage,
  processDownloadReconciliation,
  recoverDownloadReconciliations,
} from '@server/usecases/downloads'

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (
      url.pathname === '/api' ||
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/auth/') ||
      url.pathname === PROTECTED_RESOURCE_METADATA_PATH
    ) {
      return app.fetch(request, env, ctx)
    }

    return env.ASSETS.fetch(request)
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(env))
  },
  async queue(
    batch: MessageBatch<DownloadDispatchMessage | ConnectorSyncMessage | DownloadReconciliationMessage>,
    env: Env,
  ): Promise<void> {
    for (const message of batch.messages) {
      const trace = continueTrace(message.body)
      const tracedDeps = createDeps(env, trace)
      if (isDownloadReconciliationMessage(message.body)) {
        try {
          const delaySeconds = await processDownloadReconciliation(tracedDeps, message.body)
          if (delaySeconds) {
            await tracedDeps.downloadReconciliationQueue?.enqueue(
              { userId: message.body.userId, downloadId: message.body.downloadId },
              delaySeconds,
            )
          }
          message.ack()
        } catch (error) {
          console.error(
            JSON.stringify({
              event: 'download.reconciliation.failed',
              downloadId: message.body.downloadId,
              errorClass: error instanceof Error ? error.name : 'UnknownError',
              traceId: trace.traceId,
              spanId: trace.spanId,
            }),
          )
          message.retry({ delaySeconds: 60 })
        }
        continue
      }
      if (isConnectorSyncMessage(message.body)) {
        try {
          const retryAfterSeconds = await processConnectorSyncJob(tracedDeps, env, message.body)
          if (retryAfterSeconds) message.retry({ delaySeconds: retryAfterSeconds })
          else message.ack()
        } catch (error) {
          console.error(
            JSON.stringify({
              event: 'connector.sync.job.failed',
              jobId: message.body.jobId,
              errorClass: error instanceof Error ? error.name : 'UnknownError',
              traceId: trace.traceId,
              spanId: trace.spanId,
            }),
          )
          message.retry({ delaySeconds: 60 })
        }
        continue
      }
      try {
        const result = await processDownloadDispatch(tracedDeps, env, message.body)
        if (result.retryAfterSeconds) message.retry({ delaySeconds: result.retryAfterSeconds })
        else message.ack()
      } catch (error) {
        console.error(
          JSON.stringify({
            event: 'download.dispatch.failed',
            laneKey: message.body.laneKey,
            message: error instanceof Error ? error.message : 'Download dispatch failed.',
            traceId: trace.traceId,
            spanId: trace.spanId,
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
  await recoverDownloadReconciliations(deps)
}

function isConnectorSyncMessage(
  message: DownloadDispatchMessage | ConnectorSyncMessage | DownloadReconciliationMessage,
): message is ConnectorSyncMessage {
  return 'type' in message && message.type === 'connector_sync'
}

function isDownloadReconciliationMessage(
  message: DownloadDispatchMessage | ConnectorSyncMessage | DownloadReconciliationMessage,
): message is DownloadReconciliationMessage {
  return 'type' in message && message.type === 'download_reconciliation'
}
