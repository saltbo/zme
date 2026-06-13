import { describe, expect, it } from 'vitest'
import { planSaveTransition, planWatchedTransition } from './library-state'

const T1 = '2026-01-01T00:00:00.000Z'
const T2 = '2026-02-02T00:00:00.000Z'

describe('planSaveTransition', () => {
  it('creates an unwatched item when none exists', () => {
    expect(planSaveTransition(null, T1)).toEqual({ action: 'create', savedAt: T1, watchedAt: null })
  })

  it('keeps the original saved timestamp on re-save', () => {
    expect(planSaveTransition({ savedAt: T1, watchedAt: null }, T2)).toEqual({
      action: 'update',
      savedAt: T1,
      watchedAt: null,
    })
  })

  it('backfills savedAt for items that only had a watched mark', () => {
    expect(planSaveTransition({ savedAt: null, watchedAt: T1 }, T2)).toEqual({
      action: 'update',
      savedAt: T2,
      watchedAt: T1,
    })
  })
})

describe('planWatchedTransition', () => {
  it('creates a watched item (watching implies saving)', () => {
    expect(planWatchedTransition(null, true, T1)).toEqual({ action: 'create', savedAt: T1, watchedAt: T1 })
  })

  it('does nothing when un-watching a missing item', () => {
    expect(planWatchedTransition(null, false, T1)).toEqual({ action: 'none' })
  })

  it('marks an existing saved item as watched, keeping savedAt', () => {
    expect(planWatchedTransition({ savedAt: T1, watchedAt: null }, true, T2)).toEqual({
      action: 'update',
      savedAt: T1,
      watchedAt: T2,
    })
  })

  it('keeps the original watched timestamp on re-watch', () => {
    expect(planWatchedTransition({ savedAt: T1, watchedAt: T1 }, true, T2)).toEqual({
      action: 'update',
      savedAt: T1,
      watchedAt: T1,
    })
  })

  it('un-watches a saved item without deleting it', () => {
    expect(planWatchedTransition({ savedAt: T1, watchedAt: T1 }, false, T2)).toEqual({
      action: 'update',
      savedAt: T1,
      watchedAt: null,
    })
  })

  it('deletes an item that was watched but never explicitly saved', () => {
    expect(planWatchedTransition({ savedAt: null, watchedAt: T1 }, false, T2)).toEqual({ action: 'delete' })
  })
})
