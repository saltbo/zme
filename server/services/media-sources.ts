import type { MediaSourceDetails, MediaSourceHealth, MediaSourceInput, MediaSourceSummary } from '@shared/types'
import { and, eq } from 'drizzle-orm'
import type { createDb } from '../db/client'
import { type MediaSource, mediaSources } from '../db/schema'

type Db = ReturnType<typeof createDb>

interface TmdbCredentials {
  apiKey?: string
}

interface TmdbOptions {
  language?: string
}

export interface ActiveTmdbSource {
  apiKey: string
  language: string
}

export async function listMediaSources(db: Db): Promise<MediaSourceSummary[]> {
  const rows = await db.select().from(mediaSources).orderBy(mediaSources.createdAt)
  return rows.map(toSummary)
}

export async function getMediaSource(db: Db, id: string): Promise<MediaSourceDetails | null> {
  const rows = await db.select().from(mediaSources).where(eq(mediaSources.id, id)).limit(1)
  return rows[0] ? toDetails(rows[0]) : null
}

export async function createMediaSource(db: Db, input: MediaSourceInput): Promise<MediaSourceSummary> {
  const now = new Date().toISOString()
  const row: MediaSource = {
    id: crypto.randomUUID(),
    description: input.description || null,
    kind: input.kind,
    credentialsJson: JSON.stringify(input.credentials),
    optionsJson: JSON.stringify(input.options),
    enabled: input.enabled,
    healthStatus: 'unknown',
    healthMessage: null,
    healthCheckedAt: null,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(mediaSources).values(row)
  return toSummary(row)
}

export async function updateMediaSource(
  db: Db,
  id: string,
  input: MediaSourceInput,
): Promise<MediaSourceSummary | null> {
  const updatedAt = new Date().toISOString()
  const rows = await db
    .update(mediaSources)
    .set({
      description: input.description || null,
      kind: input.kind,
      credentialsJson: JSON.stringify(input.credentials),
      optionsJson: JSON.stringify(input.options),
      enabled: input.enabled,
      updatedAt,
    })
    .where(eq(mediaSources.id, id))
    .returning()

  return rows[0] ? toSummary(rows[0]) : null
}

export async function deleteMediaSource(db: Db, id: string): Promise<boolean> {
  const rows = await db.delete(mediaSources).where(eq(mediaSources.id, id)).returning({ id: mediaSources.id })
  return rows.length > 0
}

export async function getActiveTmdbSource(db: Db, requestedLanguage?: string): Promise<ActiveTmdbSource> {
  const rows = await db
    .select()
    .from(mediaSources)
    .where(and(eq(mediaSources.enabled, true), eq(mediaSources.kind, 'tmdb')))
    .limit(1)
  const source = rows[0]
  if (!source) throw new Error('TMDB media source is not configured.')

  const credentials = readJson<TmdbCredentials>(source.credentialsJson)
  if (!credentials.apiKey) throw new Error('TMDB API key is missing.')
  const options = readJson<TmdbOptions>(source.optionsJson)

  return {
    apiKey: credentials.apiKey,
    language: requestedLanguage || options.language || 'zh-CN',
  }
}

export async function checkMediaSourceHealth(db: Db, id: string): Promise<MediaSourceHealth | null> {
  const rows = await db.select().from(mediaSources).where(eq(mediaSources.id, id)).limit(1)
  const source = rows[0]
  if (!source) return null

  const checkedAt = new Date().toISOString()
  const result = await probeMediaSource(source)
  const rowsAfterUpdate = await db
    .update(mediaSources)
    .set({
      healthStatus: result.status,
      healthMessage: result.message,
      healthCheckedAt: checkedAt,
      updatedAt: checkedAt,
    })
    .where(eq(mediaSources.id, id))
    .returning()
  const updated = rowsAfterUpdate[0]
  if (!updated) return null

  return {
    status: updated.healthStatus === 'online' ? 'online' : 'offline',
    message: updated.healthMessage || result.message,
    checkedAt: updated.healthCheckedAt || checkedAt,
  }
}

function toSummary(row: MediaSource): MediaSourceSummary {
  return {
    id: row.id,
    description: row.description,
    kind: row.kind,
    enabled: row.enabled,
    healthStatus: row.healthStatus,
    healthMessage: row.healthMessage,
    healthCheckedAt: row.healthCheckedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toDetails(row: MediaSource): MediaSourceDetails {
  return {
    ...toSummary(row),
    credentials: readJson<Record<string, string>>(row.credentialsJson),
    options: readJson<Record<string, string>>(row.optionsJson),
  }
}

async function probeMediaSource(source: MediaSource): Promise<{ status: 'online' | 'offline'; message: string }> {
  try {
    const credentials = readJson<TmdbCredentials>(source.credentialsJson)
    if (!credentials.apiKey) throw new Error('TMDB API key is missing.')

    const response = await fetch('https://api.themoviedb.org/3/configuration', {
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
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

function readJson<T>(value: string): T {
  return JSON.parse(value) as T
}
