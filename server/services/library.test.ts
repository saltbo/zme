import { describe, expect, it } from 'vitest'
import type { LibraryItem } from '../db/schema'
import { deleteLibraryState, saveLibraryState, setWatchedState } from './library'

describe('library resource state identity', () => {
  it('rejects malformed media keys at the state boundary', async () => {
    await expect(saveLibraryState({} as never, 'user-1', { kind: 'book', mediaKey: 'not-a-key' })).rejects.toThrow(
      'Invalid library media key',
    )
  })

  it('rejects media keys that do not match the supplied library kind', async () => {
    await expect(
      setWatchedState({} as never, 'user-1', { kind: 'book', mediaKey: 'tmdb:movie:550' }, true),
    ).rejects.toThrow('Library kind does not match media key')
  })

  it('saves generic book state without tmdb compatibility data', async () => {
    const db = createInsertOnlyLibraryDb()

    await saveLibraryState(db as never, 'user-1', { kind: 'book', mediaKey: 'isbn:book:9780140328721' })

    expect(db.inserted).toMatchObject([
      {
        userId: 'user-1',
        mediaKey: 'isbn:book:9780140328721',
        kind: 'book',
        tmdbId: null,
      },
    ])
  })

  it('preserves tmdb compatibility data for raw tmdb state input', async () => {
    const db = createInsertOnlyLibraryDb()

    await saveLibraryState(db as never, 'user-1', { kind: 'movie', mediaKey: 'tmdb:movie:550' })

    expect(db.inserted).toMatchObject([
      {
        userId: 'user-1',
        mediaKey: 'tmdb:movie:550',
        kind: 'movie',
        tmdbId: 550,
      },
    ])
  })

  it('deletes generic resource state by media key', async () => {
    const db = createDeleteOnlyLibraryDb()

    const deleted = await deleteLibraryState(db as never, 'user-1', {
      kind: 'music',
      mediaKey: 'musicbrainz:release-group:89ad4ac3-39f7-470e-963a-56509c546377',
    })

    expect(deleted).toBe(true)
    expect(db.deleted).toBe(true)
  })
})

function createInsertOnlyLibraryDb() {
  const inserted: LibraryItem[] = []
  return {
    inserted,
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => [],
        }),
      }),
    }),
    insert: () => ({
      values: (row: LibraryItem) => {
        inserted.push(row)
      },
    }),
  } as never as {
    inserted: LibraryItem[]
  }
}

function createDeleteOnlyLibraryDb() {
  const db = {
    deleted: false,
    delete: () => ({
      where: () => ({
        returning: () => {
          db.deleted = true
          return [{ id: 'library-1' }]
        },
      }),
    }),
  }

  return db
}
