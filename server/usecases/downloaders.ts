import type {
  CreateDownloadInput,
  CreateDownloadResult,
  DownloaderDetails,
  DownloaderHealth,
  DownloaderInput,
  DownloaderSummary,
} from '@shared/types'
import type { Deps } from './deps'
import type { DownloaderRecord } from './ports'

export async function listDownloaders(deps: Deps, userId: string): Promise<DownloaderSummary[]> {
  const records = await deps.downloadersRepo.list(userId)
  return records.map(toSummary)
}

export async function getDownloader(deps: Deps, userId: string, id: string): Promise<DownloaderDetails | null> {
  const record = await deps.downloadersRepo.get(userId, id)
  return record ? toDetails(record) : null
}

export async function createDownloader(deps: Deps, userId: string, input: DownloaderInput): Promise<DownloaderSummary> {
  return toSummary(await deps.downloadersRepo.create(userId, input))
}

export async function updateDownloader(
  deps: Deps,
  userId: string,
  id: string,
  input: DownloaderInput,
): Promise<DownloaderSummary | null> {
  const record = await deps.downloadersRepo.update(userId, id, input)
  return record ? toSummary(record) : null
}

export async function deleteDownloader(deps: Deps, userId: string, id: string): Promise<boolean> {
  return deps.downloadersRepo.delete(userId, id)
}

export async function submitDownload(
  deps: Deps,
  userId: string,
  input: CreateDownloadInput,
): Promise<CreateDownloadResult> {
  const downloader = await deps.downloadersRepo.getEnabled(userId, input.downloaderId)
  if (!downloader) throw new Error('Downloader is not available.')
  const resolvedInput = await resolveDownloadInput(deps, input)

  await deps.downloaderGateways[downloader.kind].submit(downloader.config, resolvedInput)

  return {
    downloaderId: downloader.id,
    status: 'submitted',
  }
}

async function resolveDownloadInput(deps: Deps, input: CreateDownloadInput): Promise<CreateDownloadInput> {
  if (input.sourceType !== 'torrent_url') return input

  const records = await deps.indexersRepo.listEnabled()
  const matchingIndexers = records.filter((indexer) =>
    deps.indexerGateways[indexer.kind].matchesDownloadUrl(indexer.config, input.uri),
  )
  if (matchingIndexers.length === 0) return input

  for (const indexer of matchingIndexers) {
    const resolved = await deps.indexerGateways[indexer.kind].resolveDownloadSource(indexer.config, input.uri)
    if (resolved) return { ...input, ...resolved }
  }

  throw new Error('Prowlarr download URL could not be resolved.')
}

export async function checkDownloaderHealth(deps: Deps, userId: string, id: string): Promise<DownloaderHealth | null> {
  const downloader = await deps.downloadersRepo.get(userId, id)
  if (!downloader) return null

  const checkedAt = new Date().toISOString()
  const result = await probeDownloader(deps, downloader)
  const updated = await deps.downloadersRepo.setHealth(userId, id, { ...result, checkedAt })
  if (!updated) return null

  return {
    status: updated.healthStatus === 'online' ? 'online' : 'offline',
    message: updated.healthMessage || result.message,
    checkedAt: updated.healthCheckedAt || checkedAt,
  }
}

async function probeDownloader(
  deps: Deps,
  downloader: DownloaderRecord,
): Promise<{ status: 'online' | 'offline'; message: string }> {
  try {
    await deps.downloaderGateways[downloader.kind].probe(downloader.config)
    return { status: 'online', message: 'Connection check succeeded.' }
  } catch (error) {
    return {
      status: 'offline',
      message: error instanceof Error ? error.message : 'Connection check failed.',
    }
  }
}

function toSummary(record: DownloaderRecord): DownloaderSummary {
  return {
    id: record.id,
    description: record.description,
    kind: record.kind,
    endpoint: record.config.endpoint,
    enabled: record.enabled,
    healthStatus: record.healthStatus,
    healthMessage: record.healthMessage,
    healthCheckedAt: record.healthCheckedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function toDetails(record: DownloaderRecord): DownloaderDetails {
  return {
    ...toSummary(record),
    credentials: record.config.credentials,
    options: record.config.options,
  }
}
