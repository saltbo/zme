import type { MediaSourceDetails, MediaSourceHealth, MediaSourceInput, MediaSourceSummary } from '@shared/types'
import type { Deps } from './deps'
import type { ActiveMediaSource, MediaSourceRecord } from './ports'

export async function listMediaSources(deps: Deps): Promise<MediaSourceSummary[]> {
  return (await deps.mediaSourcesRepo.list()).map(toSummary)
}

export async function getMediaSource(deps: Deps, id: string): Promise<MediaSourceDetails | null> {
  const record = await deps.mediaSourcesRepo.get(id)
  return record ? toDetails(record) : null
}

export async function createMediaSource(deps: Deps, input: MediaSourceInput): Promise<MediaSourceSummary> {
  return toSummary(await deps.mediaSourcesRepo.create(input))
}

export async function updateMediaSource(
  deps: Deps,
  id: string,
  input: MediaSourceInput,
): Promise<MediaSourceSummary | null> {
  const record = await deps.mediaSourcesRepo.update(id, input)
  return record ? toSummary(record) : null
}

export async function deleteMediaSource(deps: Deps, id: string): Promise<boolean> {
  return deps.mediaSourcesRepo.delete(id)
}

export async function getActiveTmdbSource(deps: Deps, requestedLanguage?: string): Promise<ActiveMediaSource> {
  const record = await deps.mediaSourcesRepo.findEnabled('tmdb')
  if (!record) throw new Error('TMDB media source is not configured.')

  const apiKey = record.credentials.apiKey
  if (!apiKey) throw new Error('TMDB API key is missing.')

  return {
    apiKey,
    language: requestedLanguage || record.options.language || 'zh-CN',
  }
}

export async function checkMediaSourceHealth(deps: Deps, id: string): Promise<MediaSourceHealth | null> {
  const record = await deps.mediaSourcesRepo.get(id)
  if (!record) return null

  const checkedAt = new Date().toISOString()
  const result = await probeMediaSource(deps, record)
  const updated = await deps.mediaSourcesRepo.setHealth(id, { ...result, checkedAt })
  if (!updated) return null

  return {
    status: updated.healthStatus === 'online' ? 'online' : 'offline',
    message: updated.healthMessage || result.message,
    checkedAt: updated.healthCheckedAt || checkedAt,
  }
}

async function probeMediaSource(
  deps: Deps,
  record: MediaSourceRecord,
): Promise<{ status: 'online' | 'offline'; message: string }> {
  try {
    await deps.mediaProvider.probe(record.credentials)
    return { status: 'online', message: 'Connection check succeeded.' }
  } catch (error) {
    return {
      status: 'offline',
      message: error instanceof Error ? error.message : 'Connection check failed.',
    }
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
