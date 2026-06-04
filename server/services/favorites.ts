import type { FavoriteMediaInput, FavoriteMediaItem, MediaKind } from '@shared/types'
import { and, desc, eq } from 'drizzle-orm'
import type { createDb } from '../db/client'
import { type Favorite, favorites } from '../db/schema'

type Db = ReturnType<typeof createDb>

export async function listFavorites(db: Db, userId: string): Promise<FavoriteMediaItem[]> {
  const rows = await db.select().from(favorites).where(eq(favorites.userId, userId)).orderBy(desc(favorites.createdAt))
  return rows.map(toFavoriteMediaItem)
}

export async function getFavorite(
  db: Db,
  userId: string,
  kind: MediaKind,
  tmdbId: number,
): Promise<FavoriteMediaItem | null> {
  const rows = await db
    .select()
    .from(favorites)
    .where(and(eq(favorites.userId, userId), eq(favorites.mediaKey, mediaKey(kind, tmdbId))))
    .limit(1)
  return rows[0] ? toFavoriteMediaItem(rows[0]) : null
}

export async function saveFavorite(db: Db, userId: string, input: FavoriteMediaInput): Promise<FavoriteMediaItem> {
  const now = new Date().toISOString()
  const key = mediaKey(input.kind, input.id)
  const existing = await getFavoriteRow(db, userId, key)
  if (existing) {
    const rows = await db
      .update(favorites)
      .set({
        title: input.title,
        originalTitle: input.originalTitle,
        overview: input.overview,
        posterUrl: input.posterUrl,
        backdropUrl: input.backdropUrl,
        releaseYear: input.releaseYear,
        rating: input.rating,
        updatedAt: now,
      })
      .where(and(eq(favorites.userId, userId), eq(favorites.mediaKey, key)))
      .returning()

    return toFavoriteMediaItem(rows[0] ?? existing)
  }

  const row: Favorite = {
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
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(favorites).values(row)
  return toFavoriteMediaItem(row)
}

export async function deleteFavorite(db: Db, userId: string, kind: MediaKind, tmdbId: number): Promise<boolean> {
  const rows = await db
    .delete(favorites)
    .where(and(eq(favorites.userId, userId), eq(favorites.mediaKey, mediaKey(kind, tmdbId))))
    .returning({
      id: favorites.id,
    })
  return rows.length > 0
}

async function getFavoriteRow(db: Db, userId: string, key: string): Promise<Favorite | null> {
  const rows = await db
    .select()
    .from(favorites)
    .where(and(eq(favorites.userId, userId), eq(favorites.mediaKey, key)))
    .limit(1)
  return rows[0] ?? null
}

function toFavoriteMediaItem(row: Favorite): FavoriteMediaItem {
  return {
    favoriteId: row.id,
    favoritedAt: row.createdAt,
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
  }
}

function mediaKey(kind: MediaKind, tmdbId: number): string {
  return `${kind}:${tmdbId}`
}
