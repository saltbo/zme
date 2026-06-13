/**
 * Saved/watched state transition rules for library items.
 *
 * Invariants:
 * - A watched item is always saved (watching implies saving).
 * - Saving never clears an existing watched mark.
 * - Existing timestamps win over new ones (first action sets the date).
 * - Un-watching an item that was never explicitly saved removes it entirely.
 */

export interface LibraryState {
  savedAt: string | null
  watchedAt: string | null
}

export type LibraryStateTransition =
  | { action: 'create'; savedAt: string; watchedAt: string | null }
  | { action: 'update'; savedAt: string | null; watchedAt: string | null }
  | { action: 'delete' }
  | { action: 'none' }

export function planSaveTransition(
  existing: LibraryState | null,
  savedAt: string,
): Extract<LibraryStateTransition, { action: 'create' | 'update' }> {
  if (existing) {
    return {
      action: 'update',
      savedAt: existing.savedAt ?? savedAt,
      watchedAt: existing.watchedAt,
    }
  }

  return { action: 'create', savedAt, watchedAt: null }
}

export function planWatchedTransition(
  existing: LibraryState | null,
  watched: boolean,
  watchedAt: string,
): LibraryStateTransition {
  if (existing) {
    if (!watched && !existing.savedAt) return { action: 'delete' }

    return {
      action: 'update',
      savedAt: watched ? (existing.savedAt ?? watchedAt) : existing.savedAt,
      watchedAt: watched ? (existing.watchedAt ?? watchedAt) : null,
    }
  }

  if (!watched) return { action: 'none' }

  return { action: 'create', savedAt: watchedAt, watchedAt }
}
