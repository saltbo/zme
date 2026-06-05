import type { LibraryMediaInput, LibraryMediaItem, MediaKind } from '@shared/types'
import { and, desc, eq } from 'drizzle-orm'
import type { createDb } from '../db/client'
import { library, type LibraryItem } from '../db/schema'

type Db = ReturnType<typeof createDb>

export async function listLibrary(db: Db, userId: string): Promise<LibraryMediaItem[]> {
  const rows = await db.select().from(library).where(eq(library.userId, userId)).orderBy(desc(library.updatedAt))
  return rows.map(toLibraryMediaItem)
}

export async function getLibraryItem(
  db: Db,
  userId: string,
  kind: MediaKind,
  tmdbId: number,
): Promise<LibraryMediaItem | null> {
  const rows = await db
    .select()
    .from(library)
    .where(and(eq(library.userId, userId), eq(library.mediaKey, mediaKey(kind, tmdbId))))
    .limit(1)
  return rows[0] ? toLibraryMediaItem(rows[0]) : null
}

export async function saveLibraryItem(db: Db, userId: string, input: LibraryMediaInput): Promise<LibraryMediaItem> {
  const now = new Date().toISOString()
  const key = mediaKey(input.kind, input.id)
  const existing = await getLibraryRow(db, userId, key)
  if (existing) {
    const rows = await db
      .update(library)
      .set({
        title: input.title,
        originalTitle: input.originalTitle,
        overview: input.overview,
        posterUrl: input.posterUrl,
        backdropUrl: input.backdropUrl,
        releaseYear: input.releaseYear,
        rating: input.rating,
        savedAt: existing.savedAt ?? now,
        updatedAt: now,
      })
      .where(and(eq(library.userId, userId), eq(library.mediaKey, key)))
      .returning()

    return toLibraryMediaItem(rows[0] ?? existing)
  }

  const row: LibraryItem = {
    id: crypto.randomUUID(),
    userId,
    mediaKey: key,
    kind: input.kind,
    tmdbId: input.id,
    title: input.title,
    originalTitle: input.originalTitle,
    overview: input.overview,
    posterUrl: input.posterUrl,
    backdropUrl: input.backdropUrl,
    releaseYear: input.releaseYear,
    rating: input.rating,
    savedAt: now,
    watchedAt: null,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(library).values(row)
  return toLibraryMediaItem(row)
}

export async function deleteLibraryItem(db: Db, userId: string, kind: MediaKind, tmdbId: number): Promise<boolean> {
  const key = mediaKey(kind, tmdbId)
  const existing = await getLibraryRow(db, userId, key)
  if (!existing) return false

  const rows = await db.delete(library).where(and(eq(library.userId, userId), eq(library.mediaKey, key))).returning({
    id: library.id,
  })
  return rows.length > 0
}

export async function setWatched(
  db: Db,
  userId: string,
  input: LibraryMediaInput,
  watched: boolean,
): Promise<LibraryMediaItem | null> {
  const now = new Date().toISOString()
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
        title: input.title,
        originalTitle: input.originalTitle,
        overview: input.overview,
        posterUrl: input.posterUrl,
        backdropUrl: input.backdropUrl,
        releaseYear: input.releaseYear,
        rating: input.rating,
        savedAt: watched ? (existing.savedAt ?? now) : existing.savedAt,
        watchedAt: watched ? (existing.watchedAt ?? now) : null,
        updatedAt: now,
      })
      .where(and(eq(library.userId, userId), eq(library.mediaKey, key)))
      .returning()

    return rows[0] ? toLibraryMediaItem(rows[0]) : null
  }

  if (!watched) return null

  const row: LibraryItem = {
    id: crypto.randomUUID(),
    userId,
    mediaKey: key,
    kind: input.kind,
    tmdbId: input.id,
    title: input.title,
    originalTitle: input.originalTitle,
    overview: input.overview,
    posterUrl: input.posterUrl,
    backdropUrl: input.backdropUrl,
    releaseYear: input.releaseYear,
    rating: input.rating,
    savedAt: now,
    watchedAt: now,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(library).values(row)
  return toLibraryMediaItem(row)
}

export async function deleteWatched(db: Db, userId: string, kind: MediaKind, tmdbId: number): Promise<LibraryMediaItem | null> {
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

  return rows[0] ? toLibraryMediaItem(rows[0]) : null
}

async function getLibraryRow(db: Db, userId: string, key: string): Promise<LibraryItem | null> {
  const rows = await db
    .select()
    .from(library)
    .where(and(eq(library.userId, userId), eq(library.mediaKey, key)))
    .limit(1)
  return rows[0] ?? null
}

function toLibraryMediaItem(row: LibraryItem): LibraryMediaItem {
  return {
    libraryItemId: row.id,
    savedAt: row.savedAt,
    watchedAt: row.watchedAt,
    updatedAt: row.updatedAt,
    id: row.tmdbId,
    kind: row.kind,
    title: row.title,
    originalTitle: row.originalTitle,
    overview: row.overview,
    posterUrl: row.posterUrl,
    backdropUrl: row.backdropUrl,
    releaseYear: row.releaseYear,
    rating: row.rating,
    genres: [],
  }
}

function mediaKey(kind: MediaKind, tmdbId: number): string {
  return `${kind}:${tmdbId}`
}
