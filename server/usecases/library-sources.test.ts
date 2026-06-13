import type { MediaSearchItem } from '@shared/types'
import { describe, expect, it } from 'vitest'
import type { Deps } from './deps'
import { syncLibrarySource } from './library-sources'
import type { ImportedLibraryEntry, LibraryRecord, LibrarySourceRecord } from './ports'

const sourceRecord: LibrarySourceRecord = {
  id: 'source-1',
  userId: 'user-1',
  source: 'douban',
  profileId: 'profile-1',
  enabled: true,
  lastSyncedAt: null,
  lastError: null,
  lastResult: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
}

function mediaItem(id: number, title: string): MediaSearchItem {
  return {
    id,
    kind: 'movie',
    title,
    originalTitle: title,
    overview: '',
    posterUrl: null,
    backdropUrl: null,
    releaseYear: '2020',
    rating: 8,
    genres: [],
  }
}

interface SyncFixture {
  deps: Deps
  inserted: LibraryRecord[]
  synced: Array<{ id: string; result: unknown; error: string | null }>
}

function createSyncDeps(
  entries: ImportedLibraryEntry[],
  searchResults: Record<string, MediaSearchItem[]>,
  fetchEntries?: () => Promise<ImportedLibraryEntry[]>,
): SyncFixture {
  const inserted: LibraryRecord[] = []
  const synced: SyncFixture['synced'] = []

  const deps = {
    librarySourcesRepo: {
      get: async () => sourceRecord,
      markSynced: async (id: string, result: unknown, error: string | null) => {
        synced.push({ id, result, error })
      },
    },
    libraryImporters: {
      douban: {
        fetchEntries: fetchEntries ?? (async () => entries),
      },
    },
    mediaSourcesRepo: {
      findEnabled: async () => ({
        id: 'media-source-1',
        description: null,
        kind: 'tmdb',
        credentials: { apiKey: 'test-key' },
        options: {},
        enabled: true,
        healthStatus: 'online',
        healthMessage: null,
        healthCheckedAt: null,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      }),
    },
    mediaProvider: {
      search: async (_source: unknown, query: string) => searchResults[query] ?? [],
    },
    libraryRepo: {
      get: async () => null,
      insert: async (record: LibraryRecord) => {
        inserted.push(record)
      },
    },
  }

  return { deps: deps as never as Deps, inserted, synced }
}

describe('syncLibrarySource', () => {
  it('imports wish entries as saved and collect entries as watched, counting unmatched', async () => {
    const entries: ImportedLibraryEntry[] = [
      { sourceId: 'd1', status: 'wish', title: 'Saved Movie', aliases: [], year: '2020', markedAt: null },
      {
        sourceId: 'd2',
        status: 'collect',
        title: 'Watched Movie',
        aliases: [],
        year: '2020',
        markedAt: '2026-05-01T00:00:00.000Z',
      },
      { sourceId: 'd3', status: 'wish', title: 'Unknown Movie', aliases: [], year: null, markedAt: null },
    ]
    const { deps, inserted, synced } = createSyncDeps(entries, {
      'Saved Movie': [mediaItem(11, 'Saved Movie')],
      'Watched Movie': [mediaItem(22, 'Watched Movie')],
    })

    const result = await syncLibrarySource(deps, 'user-1', 'douban')

    expect(result).toEqual({ scanned: 3, imported: 2, saved: 1, watched: 1, unmatched: 1 })
    expect(synced).toEqual([{ id: 'source-1', result, error: null }])

    const saved = inserted.find((record) => record.tmdbId === 11)
    expect(saved).toMatchObject({ mediaKey: 'tmdb:movie:11', kind: 'movie', watchedAt: null })

    const watched = inserted.find((record) => record.tmdbId === 22)
    expect(watched).toMatchObject({
      mediaKey: 'tmdb:movie:22',
      kind: 'movie',
      savedAt: '2026-05-01T00:00:00.000Z',
      watchedAt: '2026-05-01T00:00:00.000Z',
    })
  })

  it('rejects low-confidence matches instead of importing the wrong media', async () => {
    const entries: ImportedLibraryEntry[] = [
      { sourceId: 'd1', status: 'wish', title: 'Specific Title', aliases: [], year: '2020', markedAt: null },
    ]
    const { deps, inserted } = createSyncDeps(entries, {
      'Specific Title': [mediaItem(33, 'Entirely Different Film')],
    })

    const result = await syncLibrarySource(deps, 'user-1', 'douban')

    expect(result).toEqual({ scanned: 1, imported: 0, saved: 0, watched: 0, unmatched: 1 })
    expect(inserted).toEqual([])
  })

  it('records the error and rethrows when the importer fails', async () => {
    const { deps, synced } = createSyncDeps([], {}, async () => {
      throw new Error('Douban profile is unreachable.')
    })

    await expect(syncLibrarySource(deps, 'user-1', 'douban')).rejects.toThrow('Douban profile is unreachable.')
    expect(synced).toEqual([{ id: 'source-1', result: null, error: 'Douban profile is unreachable.' }])
  })

  it('fails when the source is not configured', async () => {
    const deps = {
      librarySourcesRepo: { get: async () => null },
    } as never as Deps

    await expect(syncLibrarySource(deps, 'user-1', 'douban')).rejects.toThrow('Library source is not configured.')
  })
})
