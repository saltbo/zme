import type { Env } from '@server/env'
import type { Deps } from './deps'
import { parseMusicLaneKey } from './media-subscriptions'
import { dispatchMusicDownloadRecord } from './music-downloads'
import { MusicResourceUnavailableError } from './ports'

const LANE_LEASE_MS = 5 * 60_000
const RISK_PAUSE_MS = 6 * 60 * 60 * 1000
const MAX_ATTEMPTS = 3

export interface DownloadDispatchMessage {
  laneKey: string
  traceparent?: string
  tracestate?: string
}

export interface DownloadDispatchResult {
  retryAfterSeconds: number | null
}

export async function processDownloadDispatch(
  deps: Deps,
  env: Env,
  message: DownloadDispatchMessage,
): Promise<DownloadDispatchResult> {
  const { laneKey } = message
  const connectorId = parseMusicLaneKey(laneKey)
  if (!connectorId) throw new Error(`Unsupported download dispatch lane: ${laneKey}`)

  const now = new Date()
  const owner = crypto.randomUUID()
  const lease = await deps.dispatchLanesRepo.acquire(
    message.laneKey,
    owner,
    now.toISOString(),
    new Date(now.getTime() + LANE_LEASE_MS).toISOString(),
  )
  if (!lease.acquired) {
    const blockedUntil = maximumDate(lease.lane.nextAllowedAt, lease.lane.leaseExpiresAt)
    return { retryAfterSeconds: secondsUntil(blockedUntil) }
  }

  await deps.downloadRecordsRepo.requeueStalled(message.laneKey, now.toISOString(), now.toISOString())
  const record = await deps.downloadRecordsRepo.claimNext(message.laneKey, now.toISOString())
  if (!record) {
    await deps.dispatchLanesRepo.release(message.laneKey, owner, now.toISOString(), now.toISOString())
    return { retryAfterSeconds: null }
  }

  const connector = await deps.connectorsRepo.get(record.userId, connectorId)
  if (!connector) throw new Error(`Download dispatch connector was not found: ${connectorId}`)
  const musicConnector = deps.musicConnectors.get(connector.kind)
  if (!musicConnector) throw new Error(`Unsupported music connector: ${connector.kind}`)
  let nextDelaySeconds = musicConnector.definition.dispatchIntervalSeconds
  try {
    if (!(await deps.downloadRecordsRepo.isWanted(record.id))) {
      await deps.downloadRecordsRepo.update(record.id, record.generation, {
        status: 'canceled',
        errorMessage: null,
        updatedAt: new Date().toISOString(),
      })
    } else {
      await dispatchMusicDownloadRecord(deps, env, record, connectorId)
    }
  } catch (error) {
    const failedAt = new Date().toISOString()
    if (error instanceof MusicResourceUnavailableError) {
      await deps.downloadRecordsRepo.update(record.id, record.generation, {
        status: 'waiting_source',
        errorMessage: error.message,
        updatedAt: failedAt,
      })
    } else if (isRiskError(error)) {
      nextDelaySeconds = Math.ceil(RISK_PAUSE_MS / 1000)
      await deps.downloadRecordsRepo.update(record.id, record.generation, {
        status: 'waiting_source',
        errorMessage: getErrorMessage(error),
        updatedAt: failedAt,
      })
      console.warn(
        JSON.stringify({
          event: 'download.dispatch.risk_paused',
          laneKey: message.laneKey,
          message: getErrorMessage(error),
        }),
      )
    } else if (record.attemptCount < MAX_ATTEMPTS) {
      nextDelaySeconds = 60
      await deps.downloadRecordsRepo.update(record.id, record.generation, {
        status: 'queued',
        errorMessage: getErrorMessage(error),
        updatedAt: failedAt,
      })
    } else {
      await deps.downloadRecordsRepo.update(record.id, record.generation, {
        status: 'failed',
        errorMessage: getErrorMessage(error),
        updatedAt: failedAt,
      })
    }
  }

  const releasedAt = new Date()
  const nextAllowedAt = new Date(releasedAt.getTime() + nextDelaySeconds * 1000)
  await deps.dispatchLanesRepo.release(message.laneKey, owner, nextAllowedAt.toISOString(), releasedAt.toISOString())
  if (await deps.downloadRecordsRepo.hasQueued(message.laneKey)) {
    await deps.downloadDispatchQueue.wake(message.laneKey, nextDelaySeconds)
  }
  return { retryAfterSeconds: null }
}

export async function recoverDownloadDispatches(deps: Deps): Promise<void> {
  const recoveredAt = new Date()
  const now = recoveredAt.toISOString()
  const stalledLaneKeys = await deps.downloadRecordsRepo.requeueStalled(
    null,
    new Date(recoveredAt.getTime() - LANE_LEASE_MS).toISOString(),
    now,
  )
  const waitingLaneKeys = await deps.downloadRecordsRepo.requeueWaitingForEnabledSubscriptions(now)
  const queuedLaneKeys = await deps.downloadRecordsRepo.listRecoverableLaneKeys()
  for (const laneKey of new Set([...stalledLaneKeys, ...waitingLaneKeys, ...queuedLaneKeys])) {
    await deps.downloadDispatchQueue.wake(laneKey)
  }
}

function maximumDate(...values: Array<string | null>): string | null {
  const timestamps = values.flatMap((value) => (value ? [Date.parse(value)] : [])).filter(Number.isFinite)
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null
}

function secondsUntil(value: string | null): number {
  if (!value) return 1
  return Math.max(1, Math.ceil((Date.parse(value) - Date.now()) / 1000))
}

function isRiskError(error: unknown): boolean {
  return /risk control|code (?:429|-460|-462)|request failed: 429/i.test(getErrorMessage(error))
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Download dispatch failed.'
}
