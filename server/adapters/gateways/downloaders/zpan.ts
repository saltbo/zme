import { ZpanClient, type ZpanDownloadTask, type ZpanDownloadTaskPage } from '@server/adapters/gateways/zpan-client'
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
const snapshotPageSize = 50

export const zpanDownloaderGateway: DownloaderGateway = {
  supportedSourceTypes: ['http', 'magnet', 'torrent_url'],
  async submit(config, input) {
    const task = await getClient(config).createDownloadTask({
      source: { type: input.sourceType, uri: input.uri },
      targetFolder: getTypedDownloadDirectory(config.options.targetFolder, input.category, input.targetSubdirectory),
      name: input.title,
      category: normalizeZmeDownloadCategory(input.category),
      tags: input.tags,
    })
    return { externalTaskId: task.id }
  },

  async probe(config) {
    // ZPan dropped /api/health; listing one task verifies both reachability and the API key.
    await getClient(config).listDownloadTasks({ page: 1, pageSize: 1 })
  },
}

export const zpanDownloadTaskGateway: DownloadTaskGateway = {
  async list(config, owner, input: ListDownloadTasksInput): Promise<DownloadTaskPage> {
    const payload = await getClient(config).listDownloadTasks({
      page: input.page,
      pageSize: input.pageSize,
      status: input.status ? toZpanStatus(input.status) : undefined,
    })
    return {
      items: payload.items.map((task) => toTaskSummary(owner, task)),
      total: payload.total,
      page: payload.page,
      pageSize: payload.pageSize,
    }
  },

  async stream(config, owner, signal, emit) {
    const client = getClient(config)
    await emitSnapshot(emit, owner, await listAllDownloadTasks(client))

    await client.streamDownloadTaskEvents({}, signal, async (event) => {
      if (event.event === 'download-tasks') {
        const payload = event.data as ZpanDownloadTaskPage
        await emitSnapshot(emit, owner, await listAllDownloadTasks(client, payload))
        return
      }
      if (event.event === 'heartbeat') {
        await emitSnapshot(emit, owner, await listAllDownloadTasks(client))
        return
      }
      if (event.event === 'error') {
        const payload = event.data as { message?: string }
        await emit({ event: 'error', data: { message: payload.message || 'ZPan event stream failed' } })
      }
    })
  },
}

async function listAllDownloadTasks(client: ZpanClient, firstPage?: ZpanDownloadTaskPage) {
  const first = firstPage ?? (await client.listDownloadTasks({ page: 1, pageSize: snapshotPageSize }))
  if (first.pageSize < 1) throw new Error('ZPan returned an invalid download task page size')

  const items = [...first.items]
  const totalPages = Math.ceil(first.total / first.pageSize)
  for (let page = first.page + 1; page <= totalPages; page += 1) {
    const next = await client.listDownloadTasks({ page, pageSize: first.pageSize })
    items.push(...next.items)
  }
  return items
}

async function emitSnapshot(
  emit: Parameters<DownloadTaskGateway['stream']>[3],
  owner: DownloadTaskOwner,
  items: ZpanDownloadTask[],
) {
  await emit({ event: 'snapshot', data: { items: items.map((task) => toTaskSummary(owner, task)) } })
}

function getClient(config: ConnectorConfig) {
  return new ZpanClient(config.endpoint, config.credentials.apiKey)
}

function toTaskSummary(owner: DownloadTaskOwner, task: ZpanDownloadTask): DownloadTaskSummary {
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
    category: task.spec.labels.category,
    tags: task.spec.labels.tags,
    status: fromZpanStatus(task.status.state),
    downloadedBytes: progress.download.bytes,
    storageUploadedBytes: progress.upload.bytes,
    totalBytes: progress.download.totalBytes ?? null,
    downloadBps: progress.download.bytesPerSecond,
    storageUploadBps: progress.upload.bytesPerSecond,
    errorMessage: task.status.error?.message ?? null,
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
