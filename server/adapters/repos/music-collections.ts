import type { createDb } from '@server/db/client'
import {
  musicCollections,
  musicCollectionTracks,
  musicReleases,
  musicReleaseTracks,
  musicTrackAvailability,
  musicTracks,
} from '@server/db/schema'
import type {
  MusicCollectionRecord,
  MusicCollectionsRepo,
  MusicReleaseMetadata,
  MusicTrackRecord,
} from '@server/usecases/ports'
import type { MusicCollectionDetails, MusicCollectionSummary, MusicLibraryTrack } from '@shared/types'
import { and, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'

type Db = ReturnType<typeof createDb>
const D1_MAX_BOUND_PARAMETERS = 100
const MUSIC_COLLECTION_TRACK_PARAMETERS = 5
const MUSIC_TRACK_AVAILABILITY_PARAMETERS = 9

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

    async get(userId, id) {
      const rows = await db
        .select()
        .from(musicCollections)
        .where(and(eq(musicCollections.userId, userId), eq(musicCollections.id, id)))
        .limit(1)
      return rows[0] ? toRecord(rows[0]) : null
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
        .select({
          relation: musicCollectionTracks,
          track: musicTracks,
          releaseTrack: musicReleaseTracks,
          release: musicReleases,
          availability: musicTrackAvailability,
        })
        .from(musicCollectionTracks)
        .innerJoin(musicTracks, eq(musicCollectionTracks.trackId, musicTracks.id))
        .leftJoin(musicReleaseTracks, eq(musicCollectionTracks.releaseTrackId, musicReleaseTracks.id))
        .leftJoin(musicReleases, eq(musicReleaseTracks.releaseId, musicReleases.id))
        .leftJoin(
          musicTrackAvailability,
          and(
            eq(musicTrackAvailability.userId, userId),
            eq(musicTrackAvailability.connectorId, collection.connectorId ?? ''),
            eq(musicTrackAvailability.trackId, musicTracks.id),
          ),
        )
        .where(eq(musicCollectionTracks.collectionId, id))
        .orderBy(musicCollectionTracks.position)
      return {
        ...toSummary(collection),
        subscription: null,
        tracks: rows.map(({ relation, track, release, releaseTrack, availability }) =>
          toTrack(
            track,
            release,
            releaseTrack,
            relation.position,
            relation.addedAt,
            availability?.status,
            availability?.reason,
            availability?.providerCode,
            availability?.checkedAt,
          ),
        ),
      } satisfies MusicCollectionDetails
    },

    async getLibraryTrack(userId, id, releaseId) {
      const rows = await db
        .select({ track: musicTracks, release: musicReleases, releaseTrack: musicReleaseTracks })
        .from(musicCollectionTracks)
        .innerJoin(musicTracks, eq(musicCollectionTracks.trackId, musicTracks.id))
        .leftJoin(musicReleaseTracks, eq(musicCollectionTracks.releaseTrackId, musicReleaseTracks.id))
        .leftJoin(musicReleases, eq(musicReleaseTracks.releaseId, musicReleases.id))
        .innerJoin(musicCollections, eq(musicCollectionTracks.collectionId, musicCollections.id))
        .where(
          and(
            eq(musicTracks.id, id),
            eq(musicCollections.userId, userId),
            isNotNull(musicCollections.libraryAddedAt),
            releaseId ? eq(musicReleases.id, releaseId) : undefined,
          ),
        )
        .limit(1)
      return rows[0] ? toTrackRecord(rows[0].track, rows[0].release, rows[0].releaseTrack) : null
    },

    async getTrack(id) {
      const rows = await db
        .select({ track: musicTracks, release: musicReleases, releaseTrack: musicReleaseTracks })
        .from(musicTracks)
        .leftJoin(musicReleaseTracks, eq(musicReleaseTracks.trackId, musicTracks.id))
        .leftJoin(musicReleases, eq(musicReleaseTracks.releaseId, musicReleases.id))
        .where(eq(musicTracks.id, id))
        .limit(1)
      return rows[0] ? toTrackRecord(rows[0].track, rows[0].release, rows[0].releaseTrack) : null
    },

    async getTrackByMediaKey(mediaKey, releaseId) {
      const rows = await db
        .select({ track: musicTracks, release: musicReleases, releaseTrack: musicReleaseTracks })
        .from(musicTracks)
        .leftJoin(musicReleaseTracks, eq(musicReleaseTracks.trackId, musicTracks.id))
        .leftJoin(musicReleases, eq(musicReleaseTracks.releaseId, musicReleases.id))
        .where(and(eq(musicTracks.mediaKey, mediaKey), releaseId ? eq(musicReleases.id, releaseId) : undefined))
        .limit(1)
      return rows[0] ? toTrackRecord(rows[0].track, rows[0].release, rows[0].releaseTrack) : null
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

    async setLibrarySelections(userId, connectorId, selectedCollectionIds, updatedAt) {
      const clear = db
        .update(musicCollections)
        .set({ libraryAddedAt: null, updatedAt })
        .where(and(eq(musicCollections.userId, userId), eq(musicCollections.connectorId, connectorId)))
      if (selectedCollectionIds.length === 0) {
        await clear
        return
      }
      const selections = chunks(selectedCollectionIds, 90).map((ids) =>
        db
          .update(musicCollections)
          .set({ libraryAddedAt: updatedAt, updatedAt })
          .where(
            and(
              eq(musicCollections.userId, userId),
              eq(musicCollections.connectorId, connectorId),
              inArray(musicCollections.id, ids),
            ),
          ),
      )
      await db.batch([clear, ...selections])
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
            coverUrl: input.coverUrl,
            durationMs: input.durationMs,
            isrcsJson: JSON.stringify(input.isrcs),
            createdAt: now,
            updatedAt: now,
          })
        }
        let releaseTrackId: string | null = null
        if (input.release) {
          if (input.release.provider !== input.provider) {
            throw new Error('Music track and release providers must match.')
          }
          const releaseRows = await db
            .select()
            .from(musicReleases)
            .where(
              and(
                eq(musicReleases.provider, input.release.provider),
                eq(musicReleases.externalId, input.release.externalId),
              ),
            )
            .limit(1)
          const existingRelease = releaseRows[0]
          const releaseId = existingRelease?.id ?? crypto.randomUUID()
          if (existingRelease) {
            await db
              .update(musicReleases)
              .set({
                title: input.release.title,
                artistsJson: JSON.stringify(input.release.artists),
                releaseDate: input.release.releaseDate,
                releaseType: input.release.releaseType,
                providerReleaseType: input.release.providerReleaseType,
                coverUrl: input.release.coverUrl,
                metadataUpdatedAt: input.release.metadataUpdatedAt ?? existingRelease.metadataUpdatedAt,
                updatedAt: now,
              })
              .where(eq(musicReleases.id, releaseId))
          } else {
            await db.insert(musicReleases).values({
              id: releaseId,
              provider: input.release.provider,
              externalId: input.release.externalId,
              title: input.release.title,
              artistsJson: JSON.stringify(input.release.artists),
              releaseDate: input.release.releaseDate,
              releaseType: input.release.releaseType,
              providerReleaseType: input.release.providerReleaseType,
              coverUrl: input.release.coverUrl,
              metadataUpdatedAt: input.release.metadataUpdatedAt ?? null,
              createdAt: now,
              updatedAt: now,
            })
          }
          const releaseTrackRows = await db
            .select()
            .from(musicReleaseTracks)
            .where(and(eq(musicReleaseTracks.releaseId, releaseId), eq(musicReleaseTracks.trackId, trackId)))
            .limit(1)
          const existingReleaseTrack = releaseTrackRows[0]
          releaseTrackId = existingReleaseTrack?.id ?? crypto.randomUUID()
          if (existingReleaseTrack) {
            await db
              .update(musicReleaseTracks)
              .set({
                discNumber: input.release.discNumber,
                trackNumber: input.release.trackNumber,
                updatedAt: now,
              })
              .where(eq(musicReleaseTracks.id, releaseTrackId))
          } else {
            await db.insert(musicReleaseTracks).values({
              id: releaseTrackId,
              releaseId,
              trackId,
              discNumber: input.release.discNumber,
              trackNumber: input.release.trackNumber,
              createdAt: now,
              updatedAt: now,
            })
          }
        }
        relations.push({
          collectionId,
          trackId,
          releaseTrackId,
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

    async listReleaseMetadata(provider, externalIds, staleBefore) {
      const metadata = new Map<string, MusicReleaseMetadata>()
      for (const ids of chunks([...new Set(externalIds)], D1_MAX_BOUND_PARAMETERS - 2)) {
        const rows = await db
          .select()
          .from(musicReleases)
          .where(
            and(
              eq(musicReleases.provider, provider),
              inArray(musicReleases.externalId, ids),
              gt(musicReleases.metadataUpdatedAt, staleBefore),
            ),
          )
        for (const row of rows) {
          if (!row.metadataUpdatedAt || metadata.has(row.externalId)) continue
          metadata.set(row.externalId, {
            provider: row.provider,
            externalId: row.externalId,
            title: row.title,
            artists: JSON.parse(row.artistsJson) as string[],
            releaseDate: row.releaseDate,
            releaseType: row.releaseType,
            providerReleaseType: row.providerReleaseType,
            coverUrl: row.coverUrl,
            updatedAt: row.metadataUpdatedAt,
          })
        }
      }
      return [...metadata.values()]
    },

    async listTracksForAvailabilityCheck(userId, connectorId, staleBefore, limit) {
      const rows = await db
        .selectDistinct({ track: musicTracks })
        .from(musicCollectionTracks)
        .innerJoin(musicTracks, eq(musicCollectionTracks.trackId, musicTracks.id))
        .innerJoin(musicCollections, eq(musicCollectionTracks.collectionId, musicCollections.id))
        .leftJoin(
          musicTrackAvailability,
          and(
            eq(musicTrackAvailability.userId, userId),
            eq(musicTrackAvailability.connectorId, connectorId),
            eq(musicTrackAvailability.trackId, musicTracks.id),
          ),
        )
        .where(
          and(
            eq(musicCollections.userId, userId),
            eq(musicCollections.connectorId, connectorId),
            isNotNull(musicCollections.libraryAddedAt),
            or(
              isNull(musicTrackAvailability.trackId),
              isNull(musicTrackAvailability.checkedAt),
              lte(musicTrackAvailability.checkedAt, staleBefore),
            ),
          ),
        )
        .limit(limit)
      return rows.map(({ track }) => toTrackRecord(track, null, null))
    },

    async setTrackAvailabilities(userId, connectorId, updates) {
      const now = new Date().toISOString()
      const rows = updates.map(({ providerDetails, ...update }) => ({
        userId,
        connectorId,
        ...update,
        providerDetailsJson: JSON.stringify(providerDetails),
        updatedAt: now,
      }))
      for (const values of chunks(rows, Math.floor(D1_MAX_BOUND_PARAMETERS / MUSIC_TRACK_AVAILABILITY_PARAMETERS))) {
        await db
          .insert(musicTrackAvailability)
          .values(values)
          .onConflictDoUpdate({
            target: [musicTrackAvailability.connectorId, musicTrackAvailability.trackId],
            set: {
              status: sql`excluded.status`,
              reason: sql`excluded.reason`,
              providerCode: sql`excluded.provider_code`,
              providerDetailsJson: sql`excluded.provider_details_json`,
              checkedAt: sql`excluded.checked_at`,
              updatedAt: sql`excluded.updated_at`,
            },
          })
      }
    },

    async clearTrackAvailabilities(connectorId) {
      await db.delete(musicTrackAvailability).where(eq(musicTrackAvailability.connectorId, connectorId))
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
  release: typeof musicReleases.$inferSelect | null,
  releaseTrack: typeof musicReleaseTracks.$inferSelect | null,
  position: number,
  addedAt: string | null,
  downloadStatus: 'available' | 'unavailable' | 'unknown' | undefined,
  downloadReason: MusicLibraryTrack['downloadReason'] | undefined,
  downloadProviderCode: string | null | undefined,
  downloadCheckedAt: string | null | undefined,
): MusicLibraryTrack {
  return {
    ...toTrackRecord(row, release, releaseTrack),
    downloadStatus: downloadStatus ?? 'unknown',
    downloadReason: downloadReason ?? null,
    downloadProviderCode: downloadProviderCode ?? null,
    downloadCheckedAt: downloadCheckedAt ?? null,
    position,
    addedAt,
    downloadRecord: null,
  }
}

function toTrackRecord(
  row: typeof musicTracks.$inferSelect,
  release: typeof musicReleases.$inferSelect | null,
  releaseTrack: typeof musicReleaseTracks.$inferSelect | null,
): MusicTrackRecord {
  return {
    id: row.id,
    provider: row.provider,
    externalId: row.externalId,
    mediaKey: row.mediaKey,
    title: row.title,
    artists: JSON.parse(row.artistsJson) as string[],
    release:
      release && releaseTrack
        ? {
            id: release.id,
            provider: release.provider,
            externalId: release.externalId,
            title: release.title,
            artists: JSON.parse(release.artistsJson) as string[],
            releaseDate: release.releaseDate,
            releaseType: release.releaseType,
            providerReleaseType: release.providerReleaseType,
            coverUrl: release.coverUrl,
            discNumber: releaseTrack.discNumber,
            trackNumber: releaseTrack.trackNumber,
          }
        : null,
    coverUrl: row.coverUrl,
    durationMs: row.durationMs,
    isrcs: JSON.parse(row.isrcsJson) as string[],
  }
}
