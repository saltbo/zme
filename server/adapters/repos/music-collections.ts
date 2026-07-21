import type { createDb } from '@server/db/client'
import { musicCollections, musicCollectionTracks, musicTrackAvailability, musicTracks } from '@server/db/schema'
import type { MusicCollectionRecord, MusicCollectionsRepo, MusicTrackRecord } from '@server/usecases/ports'
import type { MusicCollectionDetails, MusicCollectionSummary, MusicLibraryTrack } from '@shared/types'
import { and, eq, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'

type Db = ReturnType<typeof createDb>
const D1_MAX_BOUND_PARAMETERS = 100
const MUSIC_COLLECTION_TRACK_PARAMETERS = 4
const MUSIC_TRACK_AVAILABILITY_PARAMETERS = 5

export function createMusicCollectionsRepo(db: Db): MusicCollectionsRepo {
  async function find(
    userId: string,
    provider: MusicCollectionRecord['provider'],
    externalId: string,
  ): Promise<MusicCollectionRecord | null> {
    const rows = await db
      .select()
      .from(musicCollections)
      .where(
        and(
          eq(musicCollections.userId, userId),
          eq(musicCollections.provider, provider),
          eq(musicCollections.externalId, externalId),
        ),
      )
      .limit(1)
    return rows[0] ? toRecord(rows[0]) : null
  }

  return {
    async listLibrary(userId, kind) {
      const rows = await db
        .select()
        .from(musicCollections)
        .where(
          and(
            eq(musicCollections.userId, userId),
            kind === 'playlist'
              ? inArray(musicCollections.kind, ['playlist', 'favorites'])
              : eq(musicCollections.kind, kind),
          ),
        )
      return rows.filter((row) => row.libraryAddedAt !== null).map(toSummary)
    },

    async listForConnector(userId, connectorId) {
      return (
        await db
          .select()
          .from(musicCollections)
          .where(and(eq(musicCollections.userId, userId), eq(musicCollections.connectorId, connectorId)))
      ).map(toSummary)
    },

    async getDetails(userId, id) {
      const collectionRows = await db
        .select()
        .from(musicCollections)
        .where(and(eq(musicCollections.userId, userId), eq(musicCollections.id, id)))
        .limit(1)
      const collection = collectionRows[0]
      if (!collection) return null

      const rows = await db
        .select({ relation: musicCollectionTracks, track: musicTracks, availability: musicTrackAvailability })
        .from(musicCollectionTracks)
        .innerJoin(musicTracks, eq(musicCollectionTracks.trackId, musicTracks.id))
        .leftJoin(
          musicTrackAvailability,
          and(eq(musicTrackAvailability.userId, userId), eq(musicTrackAvailability.trackId, musicTracks.id)),
        )
        .where(eq(musicCollectionTracks.collectionId, id))
        .orderBy(musicCollectionTracks.position)
      return {
        ...toSummary(collection),
        tracks: rows.map(({ relation, track, availability }) =>
          toTrack(track, relation.position, relation.addedAt, availability?.status, availability?.checkedAt),
        ),
      } satisfies MusicCollectionDetails
    },

    async getLibraryTrack(userId, id) {
      const rows = await db
        .select({ track: musicTracks })
        .from(musicCollectionTracks)
        .innerJoin(musicTracks, eq(musicCollectionTracks.trackId, musicTracks.id))
        .innerJoin(musicCollections, eq(musicCollectionTracks.collectionId, musicCollections.id))
        .where(
          and(eq(musicTracks.id, id), eq(musicCollections.userId, userId), isNotNull(musicCollections.libraryAddedAt)),
        )
        .limit(1)
      return rows[0] ? toTrackRecord(rows[0].track) : null
    },

    async getTrack(id) {
      const rows = await db.select().from(musicTracks).where(eq(musicTracks.id, id)).limit(1)
      return rows[0] ? toTrackRecord(rows[0]) : null
    },

    async find(userId, provider, externalId) {
      return find(userId, provider, externalId)
    },

    async upsert(userId, input) {
      const now = new Date().toISOString()
      const existing = await find(userId, input.provider, input.externalId)
      if (existing) {
        const rows = await db
          .update(musicCollections)
          .set({ ...input, updatedAt: now })
          .where(eq(musicCollections.id, existing.id))
          .returning()
        return toRecord(rows[0])
      }
      const row = { id: crypto.randomUUID(), userId, ...input, createdAt: now, updatedAt: now }
      await db.insert(musicCollections).values(row)
      return toRecord(row)
    },

    async setLibraryAdded(userId, id, libraryAddedAt) {
      const rows = await db
        .update(musicCollections)
        .set({ libraryAddedAt, updatedAt: new Date().toISOString() })
        .where(and(eq(musicCollections.userId, userId), eq(musicCollections.id, id)))
        .returning()
      return rows[0] ? toRecord(rows[0]) : null
    },

    async updateSnapshot(userId, id, input) {
      const rows = await db
        .update(musicCollections)
        .set({ ...input, updatedAt: new Date().toISOString() })
        .where(and(eq(musicCollections.userId, userId), eq(musicCollections.id, id)))
        .returning()
      return rows[0] ? toRecord(rows[0]) : null
    },

    async replaceTracks(collectionId, tracks) {
      const now = new Date().toISOString()
      const relations: (typeof musicCollectionTracks.$inferInsert)[] = []
      for (const [index, input] of tracks.entries()) {
        const existingRows = await db
          .select()
          .from(musicTracks)
          .where(and(eq(musicTracks.provider, input.provider), eq(musicTracks.externalId, input.externalId)))
          .limit(1)
        const existing = existingRows[0]
        const trackId = existing?.id ?? crypto.randomUUID()
        if (existing) {
          await db
            .update(musicTracks)
            .set({
              mediaKey: input.mediaKey,
              title: input.title,
              artistsJson: JSON.stringify(input.artists),
              albumTitle: input.albumTitle,
              albumExternalId: input.albumExternalId,
              coverUrl: input.coverUrl,
              durationMs: input.durationMs,
              isrcsJson: JSON.stringify(input.isrcs),
              updatedAt: now,
            })
            .where(eq(musicTracks.id, trackId))
        } else {
          await db.insert(musicTracks).values({
            id: trackId,
            provider: input.provider,
            externalId: input.externalId,
            mediaKey: input.mediaKey,
            title: input.title,
            artistsJson: JSON.stringify(input.artists),
            albumTitle: input.albumTitle,
            albumExternalId: input.albumExternalId,
            coverUrl: input.coverUrl,
            durationMs: input.durationMs,
            isrcsJson: JSON.stringify(input.isrcs),
            createdAt: now,
            updatedAt: now,
          })
        }
        relations.push({
          collectionId,
          trackId,
          position: index + 1,
          addedAt: input.addedAt ?? null,
        })
      }
      const clear = db.delete(musicCollectionTracks).where(eq(musicCollectionTracks.collectionId, collectionId))
      if (relations.length === 0) {
        await clear
      } else {
        const inserts = chunks(relations, Math.floor(D1_MAX_BOUND_PARAMETERS / MUSIC_COLLECTION_TRACK_PARAMETERS)).map(
          (items) => db.insert(musicCollectionTracks).values(items),
        )
        await db.batch([clear, ...inserts])
      }
    },

    async listTracksForAvailabilityCheck(userId, staleBefore, limit) {
      const rows = await db
        .selectDistinct({ track: musicTracks })
        .from(musicCollectionTracks)
        .innerJoin(musicTracks, eq(musicCollectionTracks.trackId, musicTracks.id))
        .innerJoin(musicCollections, eq(musicCollectionTracks.collectionId, musicCollections.id))
        .leftJoin(
          musicTrackAvailability,
          and(eq(musicTrackAvailability.userId, userId), eq(musicTrackAvailability.trackId, musicTracks.id)),
        )
        .where(
          and(
            eq(musicCollections.userId, userId),
            isNotNull(musicCollections.libraryAddedAt),
            eq(musicTracks.provider, 'netease'),
            or(
              isNull(musicTrackAvailability.trackId),
              and(
                eq(musicTrackAvailability.status, 'unknown'),
                or(
                  isNull(musicTrackAvailability.checkedAt),
                  lte(musicTrackAvailability.checkedAt, staleBefore.unknown),
                ),
              ),
              and(
                inArray(musicTrackAvailability.status, ['available', 'unavailable']),
                or(isNull(musicTrackAvailability.checkedAt), lte(musicTrackAvailability.checkedAt, staleBefore.known)),
              ),
            ),
          ),
        )
        .limit(limit)
      return rows.map(({ track }) => toTrackRecord(track))
    },

    async setTrackAvailabilities(userId, updates) {
      const now = new Date().toISOString()
      const rows = updates.map((update) => ({ userId, ...update, updatedAt: now }))
      for (const values of chunks(rows, Math.floor(D1_MAX_BOUND_PARAMETERS / MUSIC_TRACK_AVAILABILITY_PARAMETERS))) {
        await db
          .insert(musicTrackAvailability)
          .values(values)
          .onConflictDoUpdate({
            target: [musicTrackAvailability.userId, musicTrackAvailability.trackId],
            set: {
              status: sql`excluded.status`,
              checkedAt: sql`excluded.checked_at`,
              updatedAt: sql`excluded.updated_at`,
            },
          })
      }
    },

    async clearTrackAvailabilities(userId) {
      await db.delete(musicTrackAvailability).where(eq(musicTrackAvailability.userId, userId))
    },

    async deleteMissingConnectorCollections(connectorId, externalIds) {
      const existing = await db
        .select({ id: musicCollections.id, externalId: musicCollections.externalId })
        .from(musicCollections)
        .where(eq(musicCollections.connectorId, connectorId))
      const remoteIds = new Set(externalIds)
      const staleIds = existing.filter((item) => !remoteIds.has(item.externalId)).map((item) => item.id)
      for (const ids of chunks(staleIds, D1_MAX_BOUND_PARAMETERS)) {
        await db.delete(musicCollections).where(inArray(musicCollections.id, ids))
      }
    },

    async delete(userId, id) {
      const rows = await db
        .delete(musicCollections)
        .where(and(eq(musicCollections.userId, userId), eq(musicCollections.id, id)))
        .returning({ id: musicCollections.id })
      return rows.length > 0
    },
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

function toRecord(row: typeof musicCollections.$inferSelect): MusicCollectionRecord {
  return { userId: row.userId, connectorId: row.connectorId, ...toSummary(row) }
}

function toSummary(row: typeof musicCollections.$inferSelect): MusicCollectionSummary {
  return {
    id: row.id,
    kind: row.kind,
    provider: row.provider,
    externalId: row.externalId,
    title: row.title,
    description: row.description,
    coverUrl: row.coverUrl,
    ownerName: row.ownerName,
    trackCount: row.trackCount,
    libraryAddedAt: row.libraryAddedAt,
    remoteUpdatedAt: row.remoteUpdatedAt,
    lastSyncedAt: row.lastSyncedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toTrack(
  row: typeof musicTracks.$inferSelect,
  position: number,
  addedAt: string | null,
  downloadStatus: 'available' | 'unavailable' | 'unknown' | undefined,
  downloadCheckedAt: string | null | undefined,
): MusicLibraryTrack {
  return {
    ...toTrackRecord(row),
    downloadStatus: downloadStatus ?? 'unknown',
    downloadCheckedAt: downloadCheckedAt ?? null,
    position,
    addedAt,
  }
}

function toTrackRecord(row: typeof musicTracks.$inferSelect): MusicTrackRecord {
  return {
    id: row.id,
    provider: row.provider,
    externalId: row.externalId,
    mediaKey: row.mediaKey,
    title: row.title,
    artists: JSON.parse(row.artistsJson) as string[],
    albumTitle: row.albumTitle,
    albumExternalId: row.albumExternalId,
    coverUrl: row.coverUrl,
    durationMs: row.durationMs,
    isrcs: JSON.parse(row.isrcsJson) as string[],
  }
}
