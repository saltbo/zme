import type {
  CreateDownloadInput,
  CreateDownloadResult,
  DownloaderDetails,
  DownloaderHealth,
  DownloaderInput,
  DownloaderSummary,
} from '@shared/types'
import { and, eq } from 'drizzle-orm'
import { downloaderGateways } from '../adapters/gateways/downloaders'
import { indexerGateways } from '../adapters/gateways/indexers'
import type { createDb } from '../db/client'
import { type Downloader, downloaders, indexers } from '../db/schema'
import { toConnectorConfig } from './connectors'

type Db = ReturnType<typeof createDb>

export async function listDownloaders(db: Db, userId: string): Promise<DownloaderSummary[]> {
  const rows = await db.select().from(downloaders).where(eq(downloaders.userId, userId)).orderBy(downloaders.createdAt)
  return rows.map(toSummary)
}

export async function getDownloader(db: Db, userId: string, id: string): Promise<DownloaderDetails | null> {
  const rows = await db
    .select()
    .from(downloaders)
    .where(and(eq(downloaders.id, id), eq(downloaders.userId, userId)))
    .limit(1)
  return rows[0] ? toDetails(rows[0]) : null
}

export async function createDownloader(db: Db, userId: string, input: DownloaderInput): Promise<DownloaderSummary> {
  const now = new Date().toISOString()
  const row: Downloader = {
    id: crypto.randomUUID(),
    userId,
    description: input.description || null,
    kind: input.kind,
    endpoint: input.endpoint,
    credentialsJson: JSON.stringify(input.credentials),
    optionsJson: JSON.stringify(input.options),
    enabled: input.enabled,
    healthStatus: 'unknown',
    healthMessage: null,
    healthCheckedAt: null,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(downloaders).values(row)
  return toSummary(row)
}

export async function updateDownloader(
  db: Db,
  userId: string,
  id: string,
  input: DownloaderInput,
): Promise<DownloaderSummary | null> {
  const updatedAt = new Date().toISOString()
  const rows = await db
    .update(downloaders)
    .set({
      description: input.description || null,
      kind: input.kind,
      endpoint: input.endpoint,
      credentialsJson: JSON.stringify(input.credentials),
      optionsJson: JSON.stringify(input.options),
      enabled: input.enabled,
      updatedAt,
    })
    .where(and(eq(downloaders.id, id), eq(downloaders.userId, userId)))
    .returning()

  return rows[0] ? toSummary(rows[0]) : null
}

export async function deleteDownloader(db: Db, userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(downloaders)
    .where(and(eq(downloaders.id, id), eq(downloaders.userId, userId)))
    .returning({ id: downloaders.id })
  return rows.length > 0
}

export async function submitDownload(
  db: Db,
  userId: string,
  input: CreateDownloadInput,
): Promise<CreateDownloadResult> {
  const rows = await db
    .select()
    .from(downloaders)
    .where(and(eq(downloaders.id, input.downloaderId), eq(downloaders.userId, userId), eq(downloaders.enabled, true)))
    .limit(1)
  const downloader = rows[0]
  if (!downloader) throw new Error('Downloader is not available.')
  const resolvedInput = await resolveDownloadInput(db, input)

  await downloaderGateways[downloader.kind].submit(toConnectorConfig(downloader), resolvedInput)

  return {
    downloaderId: downloader.id,
    status: 'submitted',
  }
}

async function resolveDownloadInput(db: Db, input: CreateDownloadInput): Promise<CreateDownloadInput> {
  if (input.sourceType !== 'torrent_url') return input

  const rows = await db
    .select()
    .from(indexers)
    .where(and(eq(indexers.enabled, true), eq(indexers.kind, 'prowlarr')))
  const matchingIndexers = rows.filter((indexer) =>
    indexerGateways[indexer.kind].matchesDownloadUrl(toConnectorConfig(indexer), input.uri),
  )
  if (matchingIndexers.length === 0) return input

  for (const indexer of matchingIndexers) {
    const resolved = await indexerGateways[indexer.kind].resolveDownloadSource(toConnectorConfig(indexer), input.uri)
    if (resolved) return { ...input, ...resolved }
  }

  throw new Error('Prowlarr download URL could not be resolved.')
}

export async function checkDownloaderHealth(db: Db, userId: string, id: string): Promise<DownloaderHealth | null> {
  const rows = await db
    .select()
    .from(downloaders)
    .where(and(eq(downloaders.id, id), eq(downloaders.userId, userId)))
    .limit(1)
  const downloader = rows[0]
  if (!downloader) return null

  const checkedAt = new Date().toISOString()
  const result = await probeDownloader(downloader)
  const rowsAfterUpdate = await db
    .update(downloaders)
    .set({
      healthStatus: result.status,
      healthMessage: result.message,
      healthCheckedAt: checkedAt,
      updatedAt: checkedAt,
    })
    .where(and(eq(downloaders.id, id), eq(downloaders.userId, userId)))
    .returning()

  const updated = rowsAfterUpdate[0]
  if (!updated) return null
  return {
    status: updated.healthStatus === 'online' ? 'online' : 'offline',
    message: updated.healthMessage || result.message,
    checkedAt: updated.healthCheckedAt || checkedAt,
  }
}

async function probeDownloader(downloader: Downloader): Promise<{ status: 'online' | 'offline'; message: string }> {
  try {
    await downloaderGateways[downloader.kind].probe(toConnectorConfig(downloader))
    return { status: 'online', message: 'Connection check succeeded.' }
  } catch (error) {
    return {
      status: 'offline',
      message: error instanceof Error ? error.message : 'Connection check failed.',
    }
  }
}

function toSummary(row: Downloader): DownloaderSummary {
  return {
    id: row.id,
    description: row.description,
    kind: row.kind,
    endpoint: row.endpoint,
    enabled: row.enabled,
    healthStatus: row.healthStatus,
    healthMessage: row.healthMessage,
    healthCheckedAt: row.healthCheckedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toDetails(row: Downloader): DownloaderDetails {
  return {
    ...toSummary(row),
    credentials: JSON.parse(row.credentialsJson) as Record<string, string>,
    options: JSON.parse(row.optionsJson) as Record<string, string>,
  }
}
