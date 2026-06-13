import type {
  CreateDownloadInput,
  CreateDownloadResult,
  DownloaderDetails,
  DownloaderHealth,
  DownloaderInput,
  DownloaderSummary,
} from '@shared/types'
import { downloaderGateways } from '../adapters/gateways/downloaders'
import { indexerGateways } from '../adapters/gateways/indexers'
import { createDownloadersRepo } from '../adapters/repos/downloaders'
import { createIndexersRepo } from '../adapters/repos/indexers'
import type { createDb } from '../db/client'
import type { DownloaderRecord } from '../usecases/ports'

type Db = ReturnType<typeof createDb>

export async function listDownloaders(db: Db, userId: string): Promise<DownloaderSummary[]> {
  const records = await createDownloadersRepo(db).list(userId)
  return records.map(toSummary)
}

export async function getDownloader(db: Db, userId: string, id: string): Promise<DownloaderDetails | null> {
  const record = await createDownloadersRepo(db).get(userId, id)
  return record ? toDetails(record) : null
}

export async function createDownloader(db: Db, userId: string, input: DownloaderInput): Promise<DownloaderSummary> {
  return toSummary(await createDownloadersRepo(db).create(userId, input))
}

export async function updateDownloader(
  db: Db,
  userId: string,
  id: string,
  input: DownloaderInput,
): Promise<DownloaderSummary | null> {
  const record = await createDownloadersRepo(db).update(userId, id, input)
  return record ? toSummary(record) : null
}

export async function deleteDownloader(db: Db, userId: string, id: string): Promise<boolean> {
  return createDownloadersRepo(db).delete(userId, id)
}

export async function submitDownload(
  db: Db,
  userId: string,
  input: CreateDownloadInput,
): Promise<CreateDownloadResult> {
  const downloader = await createDownloadersRepo(db).getEnabled(userId, input.downloaderId)
  if (!downloader) throw new Error('Downloader is not available.')
  const resolvedInput = await resolveDownloadInput(db, input)

  await downloaderGateways[downloader.kind].submit(downloader.config, resolvedInput)

  return {
    downloaderId: downloader.id,
    status: 'submitted',
  }
}

async function resolveDownloadInput(db: Db, input: CreateDownloadInput): Promise<CreateDownloadInput> {
  if (input.sourceType !== 'torrent_url') return input

  const records = await createIndexersRepo(db).listEnabled()
  const matchingIndexers = records.filter((indexer) =>
    indexerGateways[indexer.kind].matchesDownloadUrl(indexer.config, input.uri),
  )
  if (matchingIndexers.length === 0) return input

  for (const indexer of matchingIndexers) {
    const resolved = await indexerGateways[indexer.kind].resolveDownloadSource(indexer.config, input.uri)
    if (resolved) return { ...input, ...resolved }
  }

  throw new Error('Prowlarr download URL could not be resolved.')
}

export async function checkDownloaderHealth(db: Db, userId: string, id: string): Promise<DownloaderHealth | null> {
  const repo = createDownloadersRepo(db)
  const downloader = await repo.get(userId, id)
  if (!downloader) return null

  const checkedAt = new Date().toISOString()
  const result = await probeDownloader(downloader)
  const updated = await repo.setHealth(userId, id, { ...result, checkedAt })
  if (!updated) return null

  return {
    status: updated.healthStatus === 'online' ? 'online' : 'offline',
    message: updated.healthMessage || result.message,
    checkedAt: updated.healthCheckedAt || checkedAt,
  }
}

async function probeDownloader(
  downloader: DownloaderRecord,
): Promise<{ status: 'online' | 'offline'; message: string }> {
  try {
    await downloaderGateways[downloader.kind].probe(downloader.config)
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
