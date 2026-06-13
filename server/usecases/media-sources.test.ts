import { describe, expect, it } from 'vitest'
import type { Deps } from './deps'
import { checkMediaSourceHealth, getActiveTmdbSource } from './media-sources'
import type { MediaSourceRecord } from './ports'

function sourceRecord(overrides: Partial<MediaSourceRecord> = {}): MediaSourceRecord {
  return {
    id: 'media-source-1',
    description: null,
    kind: 'tmdb',
    credentials: { apiKey: 'tmdb-key' },
    options: {},
    enabled: true,
    healthStatus: 'online',
    healthMessage: null,
    healthCheckedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('getActiveTmdbSource', () => {
  function depsWith(record: MediaSourceRecord | null): Deps {
    return { mediaSourcesRepo: { findEnabled: async () => record } } as never as Deps
  }

  it('fails when no source is configured', async () => {
    await expect(getActiveTmdbSource(depsWith(null))).rejects.toThrow('TMDB media source is not configured.')
  })

  it('fails when the source has no api key', async () => {
    await expect(getActiveTmdbSource(depsWith(sourceRecord({ credentials: {} })))).rejects.toThrow(
      'TMDB API key is missing.',
    )
  })

  it('resolves language by request > source option > default', async () => {
    const record = sourceRecord({ options: { language: 'en-US' } })

    expect(await getActiveTmdbSource(depsWith(record), 'fr-FR')).toEqual({ apiKey: 'tmdb-key', language: 'fr-FR' })
    expect(await getActiveTmdbSource(depsWith(record))).toEqual({ apiKey: 'tmdb-key', language: 'en-US' })
    expect(await getActiveTmdbSource(depsWith(sourceRecord()))).toEqual({ apiKey: 'tmdb-key', language: 'zh-CN' })
  })
})

describe('checkMediaSourceHealth', () => {
  function createDeps(probe: () => Promise<void>) {
    const record = sourceRecord()
    return {
      mediaSourcesRepo: {
        get: async () => record,
        setHealth: async (
          _id: string,
          patch: { status: 'online' | 'offline'; message: string; checkedAt: string },
        ) => ({
          ...record,
          healthStatus: patch.status,
          healthMessage: patch.message,
          healthCheckedAt: patch.checkedAt,
        }),
      },
      mediaProvider: { probe },
    } as never as Deps
  }

  it('reports online when the provider probe succeeds', async () => {
    const health = await checkMediaSourceHealth(
      createDeps(async () => {}),
      'media-source-1',
    )
    expect(health?.status).toBe('online')
  })

  it('reports offline with the probe error message', async () => {
    const health = await checkMediaSourceHealth(
      createDeps(async () => {
        throw new Error('TMDB request failed: 401')
      }),
      'media-source-1',
    )
    expect(health).toMatchObject({ status: 'offline', message: 'TMDB request failed: 401' })
  })
})
