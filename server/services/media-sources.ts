import type { MediaSourceDetails, MediaSourceHealth, MediaSourceInput, MediaSourceSummary } from '@shared/types'
import { createMediaSourcesRepo } from '../adapters/repos/media-sources'
import type { createDb } from '../db/client'
import type { MediaSourceRecord } from '../usecases/ports'

type Db = ReturnType<typeof createDb>

export interface ActiveTmdbSource {
  apiKey: string
  language: string
}

export async function listMediaSources(db: Db): Promise<MediaSourceSummary[]> {
  const records = await createMediaSourcesRepo(db).list()
  return records.map(toSummary)
}

export async function getMediaSource(db: Db, id: string): Promise<MediaSourceDetails | null> {
  const record = await createMediaSourcesRepo(db).get(id)
  return record ? toDetails(record) : null
}

export async function createMediaSource(db: Db, input: MediaSourceInput): Promise<MediaSourceSummary> {
  return toSummary(await createMediaSourcesRepo(db).create(input))
}

export async function updateMediaSource(
  db: Db,
  id: string,
  input: MediaSourceInput,
): Promise<MediaSourceSummary | null> {
  const record = await createMediaSourcesRepo(db).update(id, input)
  return record ? toSummary(record) : null
}

export async function deleteMediaSource(db: Db, id: string): Promise<boolean> {
  return createMediaSourcesRepo(db).delete(id)
}

export async function getActiveTmdbSource(db: Db, requestedLanguage?: string): Promise<ActiveTmdbSource> {
  const record = await createMediaSourcesRepo(db).findEnabled('tmdb')
  if (!record) throw new Error('TMDB media source is not configured.')

  const apiKey = record.credentials.apiKey
  if (!apiKey) throw new Error('TMDB API key is missing.')

  return {
    apiKey,
    language: requestedLanguage || record.options.language || 'zh-CN',
  }
}

export async function checkMediaSourceHealth(db: Db, id: string): Promise<MediaSourceHealth | null> {
  const repo = createMediaSourcesRepo(db)
  const record = await repo.get(id)
  if (!record) return null

  const checkedAt = new Date().toISOString()
  const result = await probeMediaSource(record)
  const updated = await repo.setHealth(id, { ...result, checkedAt })
  if (!updated) return null

  return {
    status: updated.healthStatus === 'online' ? 'online' : 'offline',
    message: updated.healthMessage || result.message,
    checkedAt: updated.healthCheckedAt || checkedAt,
  }
}

function toSummary(record: MediaSourceRecord): MediaSourceSummary {
  return {
    id: record.id,
    description: record.description,
    kind: record.kind,
    enabled: record.enabled,
    healthStatus: record.healthStatus,
    healthMessage: record.healthMessage,
    healthCheckedAt: record.healthCheckedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function toDetails(record: MediaSourceRecord): MediaSourceDetails {
  return {
    ...toSummary(record),
    credentials: record.credentials,
    options: record.options,
  }
}

async function probeMediaSource(record: MediaSourceRecord): Promise<{ status: 'online' | 'offline'; message: string }> {
  try {
    const apiKey = record.credentials.apiKey
    if (!apiKey) throw new Error('TMDB API key is missing.')

    const response = await fetch('https://api.themoviedb.org/3/configuration', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    })
    if (!response.ok) throw new Error(`TMDB request failed: ${response.status}`)
    return { status: 'online', message: 'Connection check succeeded.' }
  } catch (error) {
    return {
      status: 'offline',
      message: error instanceof Error ? error.message : 'Connection check failed.',
    }
  }
}
