import {
  ZpanClient,
  type ZpanDownloadTask,
  type ZpanDownloadTaskListItem,
  type ZpanDownloadTaskPage,
  type ZpanListDownloadTasksParams,
} from '@server/adapters/gateways/zpan-client'
import type {
  ConnectorConfig,
  DownloaderGateway,
  DownloadTaskGateway,
  DownloadTaskOwner,
  ListDownloadTasksInput,
} from '@server/usecases/ports'
import { normalizeZmeDownloadCategory } from '@shared/download-metadata'
import type { DownloaderKind, DownloadTaskPage, DownloadTaskStatus, DownloadTaskSummary } from '@shared/types'
import { getTypedDownloadDirectory } from './shared'

type ZpanDownloadTaskState = ZpanDownloadTask['status']['state']
const upstreamPageSize = 100
const maxUpstreamPages = 100
const upstreamScanTimeoutMs = 10_000

export const zpanDownloaderGateway: DownloaderGateway = {
  supportedSourceTypes: ['http', 'magnet', 'torrent_url'],
  async submit(config, input, idempotencyKey) {
    const task = await getClient(config).createDownloadTask(
      {
        source: { type: input.sourceType, uri: input.uri },
        targetFolder: getTypedDownloadDirectory(config.options.targetFolder, input.category, input.targetSubdirectory),
        name: input.title,
        category: normalizeZmeDownloadCategory(input.category),
        tags: input.tags,
      },
      idempotencyKey,
    )
    return { externalTaskId: task.id }
  },

  async probe(config) {
    // ZPan dropped /api/health; listing one task verifies both reachability and the API key.
    await getClient(config).listDownloadTasks({ pageSize: 1 })
  },
}

export const zpanDownloadTaskGateway: DownloadTaskGateway = {
  async get(config, owner, id) {
    const task = await getClient(config).getDownloadTask({ id })
    return task ? toTaskSummary(owner, task) : null
  },
  async list(config, owner, input: ListDownloadTasksInput, signal?: AbortSignal): Promise<DownloadTaskPage> {
    const items = await listAllDownloadTasks(
      getClient(config),
      {
        status: input.status ? toZpanStatus(input.status) : undefined,
      },
      signal,
    )
    const start = (input.page - 1) * input.pageSize
    return {
      items: items.slice(start, start + input.pageSize).map((task) => toTaskSummary(owner, task)),
      total: items.length,
      page: input.page,
      pageSize: input.pageSize,
    }
  },

  async stream(config, owner, signal, emit) {
    const client = getClient(config)
    await emitSnapshot(emit, owner, await listAllDownloadTasks(client, {}, signal))

    await client.streamDownloadTaskEvents(signal, async (event) => {
      if (event.event === 'resource-change' || event.event === 'resync' || event.event === 'heartbeat') {
        await emitSnapshot(emit, owner, await listAllDownloadTasks(client, {}, signal))
        return
      }
      if (event.event === 'error') {
        await emit({ event: 'error', data: { message: getZpanEventErrorMessage(event.data) } })
      }
    })
  },
}

function getZpanEventErrorMessage(data: unknown) {
  if (typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string') {
    return data.message
  }
  throw new Error('ZPan error event returned an invalid payload')
}

async function listAllDownloadTasks(
  client: ZpanClient,
  query: Pick<ZpanListDownloadTasksParams, 'status'> = {},
  signal?: AbortSignal,
): Promise<ZpanDownloadTaskListItem[]> {
  const items: ZpanDownloadTaskListItem[] = []
  const seenPageTokens = new Set<string>()
  const timeoutController = new AbortController()
  const timeout = setTimeout(() => timeoutController.abort(), upstreamScanTimeoutMs)
  const timeoutSignal = timeoutController.signal
  const scanSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  let page: ZpanDownloadTaskPage
  let pageToken: string | undefined
  let pageCount = 0

  try {
    do {
      if (scanSignal.aborted) throw scanSignal.reason
      pageCount += 1
      if (pageCount > maxUpstreamPages) {
        throw new Error(`ZPan download task scan exceeded ${maxUpstreamPages} pages`)
      }
      page = await client.listDownloadTasks({ ...query, pageSize: upstreamPageSize, pageToken }, scanSignal)
      items.push(...page.items)
      pageToken = page.nextPageToken || undefined
      if (pageToken && seenPageTokens.has(pageToken)) {
        throw new Error('ZPan repeated a download task page token')
      }
      if (pageToken) seenPageTokens.add(pageToken)
    } while (pageToken)
  } catch (error) {
    if (signal?.aborted) throw new Error('ZPan download task scan canceled', { cause: error })
    if (timeoutSignal.aborted) throw new Error('ZPan download task scan timed out', { cause: error })
    throw error
  } finally {
    clearTimeout(timeout)
  }

  return items
}

type ZpanTaskSummarySource = {
  id: string
  spec: {
    source: { type: ZpanDownloadTask['spec']['source']['type']; uri: string }
    destination: { folder: string; name?: string | null }
    labels: { category?: string | null; tags: string[] }
  }
  status: {
    state: ZpanDownloadTaskState
    progress: ZpanDownloadTask['status']['progress']
    runtime?: {
      progress?: ZpanDownloadTask['status']['progress']
      torrent?: { name?: string }
      updatedAt?: string
    } | null
    error?: { message?: string } | null
    output?: { objectId?: string } | null
    updatedAt?: string
  }
}

async function emitSnapshot(
  emit: Parameters<DownloadTaskGateway['stream']>[3],
  owner: DownloadTaskOwner,
  items: ZpanTaskSummarySource[],
) {
  await emit({ event: 'snapshot', data: { items: items.map((task) => toTaskSummary(owner, task)) } })
}

function getClient(config: ConnectorConfig) {
  return new ZpanClient(config.endpoint, config.credentials.apiKey)
}

function toTaskSummary(owner: DownloadTaskOwner, task: ZpanTaskSummarySource): DownloadTaskSummary {
  const progress = task.status.runtime?.progress ?? task.status.progress
  const name = task.spec.destination.name || task.status.runtime?.torrent?.name || task.spec.source.uri

  return {
    id: task.id,
    downloaderId: owner.downloaderId,
    downloaderName: owner.downloaderName,
    downloaderKind: owner.downloaderKind as DownloaderKind,
    sourceType: task.spec.source.type,
    sourceUri: task.spec.source.uri,
    name,
    targetFolder: task.spec.destination.folder,
    category: task.spec.labels.category ?? null,
    tags: task.spec.labels.tags,
    status: fromZpanStatus(task.status.state),
    downloadedBytes: progress.download.bytes,
    storageUploadedBytes: progress.upload.bytes,
    totalBytes: progress.download.totalBytes ?? null,
    downloadBps: progress.download.bytesPerSecond,
    storageUploadBps: progress.upload.bytesPerSecond,
    errorMessage: task.status.error?.message ?? null,
    outputObjectId: task.status.output?.objectId ?? null,
    downstreamRevision: task.status.updatedAt || null,
  }
}

function toZpanStatus(status: DownloadTaskStatus): ZpanDownloadTaskState {
  if (status === 'running') return 'downloading'
  if (status === 'billing_paused') return 'suspended'
  return status
}

function fromZpanStatus(status: ZpanDownloadTaskState): DownloadTaskStatus {
  if (status === 'downloading' || status === 'interrupted') return 'running'
  if (status === 'suspended') return 'billing_paused'
  return status
}
