import type { createDb } from '@server/db/client'
import { torrentQuerySnapshots, torrentSnapshots } from '@server/db/schema'
import type { TorrentSnapshotRecord, TorrentSnapshotsRepo } from '@server/usecases/ports'
import type { IndexerSearchItem } from '@shared/types'
import { and, eq, gt, inArray, lt, sql } from 'drizzle-orm'

type Db = ReturnType<typeof createDb>
const D1_MAX_BOUND_PARAMETERS = 100
const TORRENT_SNAPSHOT_PARAMETERS = 6
const TORRENT_SNAPSHOT_CHUNK_SIZE = Math.floor(D1_MAX_BOUND_PARAMETERS / TORRENT_SNAPSHOT_PARAMETERS)

export function createTorrentSnapshotsRepo(db: Db): TorrentSnapshotsRepo {
  return {
    async saveQuery({ items, ...record }) {
      await db.insert(torrentQuerySnapshots).values({ ...record, itemsJson: JSON.stringify(items) })
    },
    async getQuery(userId, id, now) {
      const rows = await db
        .select()
        .from(torrentQuerySnapshots)
        .where(
          and(
            eq(torrentQuerySnapshots.id, id),
            eq(torrentQuerySnapshots.userId, userId),
            gt(torrentQuerySnapshots.expiresAt, now),
          ),
        )
        .limit(1)
      const row = rows[0]
      return row
        ? {
            id: row.id,
            querySignature: row.querySignature,
            items: JSON.parse(row.itemsJson) as IndexerSearchItem[],
            expiresAt: row.expiresAt,
          }
        : null
    },
    async saveMany(records) {
      if (records.length === 0) return
      const statements = chunks(records, TORRENT_SNAPSHOT_CHUNK_SIZE).map((batch) =>
        db
          .insert(torrentSnapshots)
          .values(batch.map(toRow))
          .onConflictDoUpdate({
            target: [torrentSnapshots.userId, torrentSnapshots.id],
            set: {
              mediaKey: sql.raw(`excluded.${torrentSnapshots.mediaKey.name}`),
              itemJson: sql.raw(`excluded.${torrentSnapshots.itemJson.name}`),
              createdAt: sql.raw(`excluded.${torrentSnapshots.createdAt.name}`),
              expiresAt: sql.raw(`excluded.${torrentSnapshots.expiresAt.name}`),
            },
          }),
      )
      const [first, ...rest] = statements
      await db.batch([first, ...rest])
    },

    async get(userId, id, now) {
      const rows = await db
        .select()
        .from(torrentSnapshots)
        .where(
          and(eq(torrentSnapshots.userId, userId), eq(torrentSnapshots.id, id), gt(torrentSnapshots.expiresAt, now)),
        )
        .limit(1)
      return rows[0] ? toRecord(rows[0]) : null
    },

    async deleteExpired(now, limit) {
      await db
        .delete(torrentQuerySnapshots)
        .where(
          inArray(
            torrentQuerySnapshots.id,
            db
              .select({ id: torrentQuerySnapshots.id })
              .from(torrentQuerySnapshots)
              .where(lt(torrentQuerySnapshots.expiresAt, now))
              .limit(limit),
          ),
        )
      const expired = await db
        .select({ userId: torrentSnapshots.userId, id: torrentSnapshots.id })
        .from(torrentSnapshots)
        .where(lt(torrentSnapshots.expiresAt, now))
        .limit(limit)
      if (expired.length === 0) return 0
      const deleted = await Promise.all(
        expired.map((row) =>
          db
            .delete(torrentSnapshots)
            .where(and(eq(torrentSnapshots.userId, row.userId), eq(torrentSnapshots.id, row.id)))
            .returning({ id: torrentSnapshots.id }),
        ),
      )
      return deleted.reduce((count, rows) => count + rows.length, 0)
    },
  }
}

function toRecord(row: typeof torrentSnapshots.$inferSelect): TorrentSnapshotRecord {
  return { ...row, item: JSON.parse(row.itemJson) as IndexerSearchItem }
}

function toRow(record: TorrentSnapshotRecord): typeof torrentSnapshots.$inferInsert {
  const { item, ...row } = record
  return { ...row, itemJson: JSON.stringify(item) }
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}
