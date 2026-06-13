import { describe, expect, it } from 'vitest'
import type { Deps } from './deps'
import { deleteLibraryState, saveLibraryState, setWatchedState } from './library'
import type { LibraryRecord } from './ports'

describe('library resource state identity', () => {
  it('rejects malformed media keys at the state boundary', async () => {
    await expect(saveLibraryState(emptyDeps(), 'user-1', { kind: 'book', mediaKey: 'not-a-key' })).rejects.toThrow(
      'Invalid library media key',
    )
  })

  it('rejects media keys that do not match the supplied library kind', async () => {
    await expect(
      setWatchedState(emptyDeps(), 'user-1', { kind: 'book', mediaKey: 'tmdb:movie:550' }, true),
    ).rejects.toThrow('Library kind does not match media key')
  })

  it('saves generic book state without tmdb compatibility data', async () => {
    const deps = createInsertOnlyLibraryDeps()

    await saveLibraryState(deps, 'user-1', { kind: 'book', mediaKey: 'isbn:book:9780140328721' })

    expect(deps.inserted).toMatchObject([
      {
        userId: 'user-1',
        mediaKey: 'isbn:book:9780140328721',
        kind: 'book',
        tmdbId: null,
      },
    ])
  })

  it('preserves tmdb compatibility data for raw tmdb state input', async () => {
    const deps = createInsertOnlyLibraryDeps()

    await saveLibraryState(deps, 'user-1', { kind: 'movie', mediaKey: 'tmdb:movie:550' })

    expect(deps.inserted).toMatchObject([
      {
        userId: 'user-1',
        mediaKey: 'tmdb:movie:550',
        kind: 'movie',
        tmdbId: 550,
      },
    ])
  })

  it('deletes generic resource state by media key', async () => {
    const deps = createDeleteOnlyLibraryDeps()

    const deleted = await deleteLibraryState(deps, 'user-1', {
      kind: 'music',
      mediaKey: 'musicbrainz:release-group:89ad4ac3-39f7-470e-963a-56509c546377',
    })

    expect(deleted).toBe(true)
    expect(deps.deletedKeys).toEqual(['musicbrainz:release-group:89ad4ac3-39f7-470e-963a-56509c546377'])
  })
})

function emptyDeps(): Deps {
  return {} as never as Deps
}

function createInsertOnlyLibraryDeps(): Deps & { inserted: LibraryRecord[] } {
  const inserted: LibraryRecord[] = []
  const deps = {
    inserted,
    libraryRepo: {
      get: async () => null,
      insert: async (record: LibraryRecord) => {
        inserted.push(record)
      },
    },
  }

  return deps as never as Deps & { inserted: LibraryRecord[] }
}

function createDeleteOnlyLibraryDeps(): Deps & { deletedKeys: string[] } {
  const deletedKeys: string[] = []
  const deps = {
    deletedKeys,
    libraryRepo: {
      delete: async (_userId: string, mediaKey: string) => {
        deletedKeys.push(mediaKey)
        return true
      },
    },
  }

  return deps as never as Deps & { deletedKeys: string[] }
}
