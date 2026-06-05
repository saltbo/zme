import type { LibraryMediaInput, LibraryMediaItem, MediaKind } from '@shared/types'
import { and, desc, eq } from 'drizzle-orm'
import type { createDb } from '../db/client'
import { type LibraryItem, library } from '../db/schema'
import type { ActiveTmdbSource } from './media-sources'
import { getMediaSummary } from './tmdb'

type Db = ReturnType<typeof createDb>

export async function listLibrary(db: Db, userId: string, tmdb: ActiveTmdbSource): Promise<LibraryMediaItem[]> {
  const rows = await db.select().from(library).where(eq(library.userId, userId)).orderBy(desc(library.updatedAt))
  return Promise.all(rows.map((row) => toLibraryMediaItem(row, tmdb)))
}

export async function getLibraryItem(
  db: Db,
  userId: string,
  kind: MediaKind,
  tmdbId: number,
  tmdb: ActiveTmdbSource,
): Promise<LibraryMediaItem | null> {
  const rows = await db
    .select()
    .from(library)
    .where(and(eq(library.userId, userId), eq(library.mediaKey, mediaKey(kind, tmdbId))))
    .limit(1)
  return rows[0] ? toLibraryMediaItem(rows[0], tmdb) : null
}

export async function saveLibraryItem(
  db: Db,
  userId: string,
  input: LibraryMediaInput,
  tmdb: ActiveTmdbSource,
  savedAt?: string,
): Promise<LibraryMediaItem> {
  const now = new Date().toISOString()
  const nextSavedAt = savedAt ?? now
  const key = mediaKey(input.kind, input.id)
  const existing = await getLibraryRow(db, userId, key)
  if (existing) {
    const rows = await db
      .update(library)
      .set({
        savedAt: existing.savedAt ?? nextSavedAt,
        updatedAt: now,
      })
      .where(and(eq(library.userId, userId), eq(library.mediaKey, key)))
      .returning()

    return toLibraryMediaItem(rows[0] ?? existing, tmdb)
  }

  const row: LibraryItem = {
    id: crypto.randomUUID(),
    userId,
    mediaKey: key,
    kind: input.kind,
    tmdbId: input.id,
    savedAt: nextSavedAt,
    watchedAt: null,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(library).values(row)
  return toLibraryMediaItem(row, tmdb)
}

export async function saveLibraryState(
  db: Db,
  userId: string,
  input: LibraryMediaInput,
  savedAt?: string,
): Promise<LibraryItem> {
  const now = new Date().toISOString()
  const nextSavedAt = savedAt ?? now
  const key = mediaKey(input.kind, input.id)
  const existing = await getLibraryRow(db, userId, key)
  if (existing) {
    const rows = await db
      .update(library)
      .set({
        savedAt: existing.savedAt ?? nextSavedAt,
        updatedAt: now,
      })
      .where(and(eq(library.userId, userId), eq(library.mediaKey, key)))
      .returning()

    return rows[0] ?? existing
  }

  const row: LibraryItem = {
    id: crypto.randomUUID(),
    userId,
    mediaKey: key,
    kind: input.kind,
    tmdbId: input.id,
    savedAt: nextSavedAt,
    watchedAt: null,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(library).values(row)
  return row
}

export async function deleteLibraryItem(db: Db, userId: string, kind: MediaKind, tmdbId: number): Promise<boolean> {
  const key = mediaKey(kind, tmdbId)
  const existing = await getLibraryRow(db, userId, key)
  if (!existing) return false

  const rows = await db
    .delete(library)
    .where(and(eq(library.userId, userId), eq(library.mediaKey, key)))
    .returning({
      id: library.id,
    })
  return rows.length > 0
}

export async function setWatched(
  db: Db,
  userId: string,
  input: LibraryMediaInput,
  watched: boolean,
  tmdb: ActiveTmdbSource,
  watchedAt?: string,
): Promise<LibraryMediaItem | null> {
  const now = new Date().toISOString()
  const nextWatchedAt = watchedAt ?? now
  const key = mediaKey(input.kind, input.id)
  const existing = await getLibraryRow(db, userId, key)

  if (existing) {
    if (!watched && !existing.savedAt) {
      await db.delete(library).where(and(eq(library.userId, userId), eq(library.mediaKey, key)))
      return null
    }

    const rows = await db
      .update(library)
      .set({
        savedAt: watched ? (existing.savedAt ?? nextWatchedAt) : existing.savedAt,
        watchedAt: watched ? (existing.watchedAt ?? nextWatchedAt) : null,
        updatedAt: now,
      })
      .where(and(eq(library.userId, userId), eq(library.mediaKey, key)))
      .returning()

    return rows[0] ? toLibraryMediaItem(rows[0], tmdb) : null
  }

  if (!watched) return null

  const row: LibraryItem = {
    id: crypto.randomUUID(),
    userId,
    mediaKey: key,
    kind: input.kind,
    tmdbId: input.id,
    savedAt: nextWatchedAt,
    watchedAt: nextWatchedAt,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(library).values(row)
  return toLibraryMediaItem(row, tmdb)
}

export async function setWatchedState(
  db: Db,
  userId: string,
  input: LibraryMediaInput,
  watched: boolean,
  watchedAt?: string,
): Promise<LibraryItem | null> {
  const now = new Date().toISOString()
  const nextWatchedAt = watchedAt ?? now
  const key = mediaKey(input.kind, input.id)
  const existing = await getLibraryRow(db, userId, key)

  if (existing) {
    if (!watched && !existing.savedAt) {
      await db.delete(library).where(and(eq(library.userId, userId), eq(library.mediaKey, key)))
      return null
    }

    const rows = await db
      .update(library)
      .set({
        savedAt: watched ? (existing.savedAt ?? nextWatchedAt) : existing.savedAt,
        watchedAt: watched ? (existing.watchedAt ?? nextWatchedAt) : null,
        updatedAt: now,
      })
      .where(and(eq(library.userId, userId), eq(library.mediaKey, key)))
      .returning()

    return rows[0] ?? null
  }

  if (!watched) return null

  const row: LibraryItem = {
    id: crypto.randomUUID(),
    userId,
    mediaKey: key,
    kind: input.kind,
    tmdbId: input.id,
    savedAt: nextWatchedAt,
    watchedAt: nextWatchedAt,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(library).values(row)
  return row
}

export async function deleteWatched(
  db: Db,
  userId: string,
  kind: MediaKind,
  tmdbId: number,
  tmdb: ActiveTmdbSource,
): Promise<LibraryMediaItem | null> {
  const key = mediaKey(kind, tmdbId)
  const existing = await getLibraryRow(db, userId, key)
  if (!existing?.watchedAt) return null

  if (!existing.savedAt) {
    await db.delete(library).where(and(eq(library.userId, userId), eq(library.mediaKey, key)))
    return null
  }

  const rows = await db
    .update(library)
    .set({ watchedAt: null, updatedAt: new Date().toISOString() })
    .where(and(eq(library.userId, userId), eq(library.mediaKey, key)))
    .returning()

  return rows[0] ? toLibraryMediaItem(rows[0], tmdb) : null
}

async function getLibraryRow(db: Db, userId: string, key: string): Promise<LibraryItem | null> {
  const rows = await db
    .select()
    .from(library)
    .where(and(eq(library.userId, userId), eq(library.mediaKey, key)))
    .limit(1)
  return rows[0] ?? null
}

async function toLibraryMediaItem(row: LibraryItem, tmdb: ActiveTmdbSource): Promise<LibraryMediaItem> {
  const item = await getMediaSummary(tmdb.apiKey, row.kind, row.tmdbId, tmdb.language)
  return {
    libraryItemId: row.id,
    savedAt: row.savedAt,
    watchedAt: row.watchedAt,
    updatedAt: row.updatedAt,
    ...item,
  }
}

function mediaKey(kind: MediaKind, tmdbId: number): string {
  return `${kind}:${tmdbId}`
}
