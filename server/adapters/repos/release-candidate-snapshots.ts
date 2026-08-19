import type { createDb } from '@server/db/client'
import { releaseCandidateSnapshots } from '@server/db/schema'
import type { ReleaseCandidateSnapshotRecord, ReleaseCandidateSnapshotsRepo } from '@server/usecases/ports'
import type { IndexerSearchItem } from '@shared/types'
import { and, eq, gt, lt, sql } from 'drizzle-orm'

type Db = ReturnType<typeof createDb>
const D1_MAX_BOUND_PARAMETERS = 100
const RELEASE_CANDIDATE_SNAPSHOT_PARAMETERS = 6
const RELEASE_CANDIDATE_SNAPSHOT_CHUNK_SIZE = Math.floor(
  D1_MAX_BOUND_PARAMETERS / RELEASE_CANDIDATE_SNAPSHOT_PARAMETERS,
)

export function createReleaseCandidateSnapshotsRepo(db: Db): ReleaseCandidateSnapshotsRepo {
  return {
    async saveMany(records) {
      if (records.length === 0) return
      const statements = chunks(records, RELEASE_CANDIDATE_SNAPSHOT_CHUNK_SIZE).map((batch) =>
        db
          .insert(releaseCandidateSnapshots)
          .values(batch.map(toRow))
          .onConflictDoUpdate({
            target: [releaseCandidateSnapshots.userId, releaseCandidateSnapshots.id],
            set: {
              mediaKey: sql.raw(`excluded.${releaseCandidateSnapshots.mediaKey.name}`),
              itemJson: sql.raw(`excluded.${releaseCandidateSnapshots.itemJson.name}`),
              createdAt: sql.raw(`excluded.${releaseCandidateSnapshots.createdAt.name}`),
              expiresAt: sql.raw(`excluded.${releaseCandidateSnapshots.expiresAt.name}`),
            },
          }),
      )
      const [first, ...rest] = statements
      await db.batch([first, ...rest])
    },

    async get(userId, id, now) {
      const rows = await db
        .select()
        .from(releaseCandidateSnapshots)
        .where(
          and(
            eq(releaseCandidateSnapshots.userId, userId),
            eq(releaseCandidateSnapshots.id, id),
            gt(releaseCandidateSnapshots.expiresAt, now),
          ),
        )
        .limit(1)
      return rows[0] ? toRecord(rows[0]) : null
    },

    async deleteExpired(now, limit) {
      const expired = await db
        .select({ userId: releaseCandidateSnapshots.userId, id: releaseCandidateSnapshots.id })
        .from(releaseCandidateSnapshots)
        .where(lt(releaseCandidateSnapshots.expiresAt, now))
        .limit(limit)
      if (expired.length === 0) return 0
      const deleted = await Promise.all(
        expired.map((row) =>
          db
            .delete(releaseCandidateSnapshots)
            .where(and(eq(releaseCandidateSnapshots.userId, row.userId), eq(releaseCandidateSnapshots.id, row.id)))
            .returning({ id: releaseCandidateSnapshots.id }),
        ),
      )
      return deleted.reduce((count, rows) => count + rows.length, 0)
    },
  }
}

function toRecord(row: typeof releaseCandidateSnapshots.$inferSelect): ReleaseCandidateSnapshotRecord {
  return { ...row, item: JSON.parse(row.itemJson) as IndexerSearchItem }
}

function toRow(record: ReleaseCandidateSnapshotRecord): typeof releaseCandidateSnapshots.$inferInsert {
  const { item, ...row } = record
  return { ...row, itemJson: JSON.stringify(item) }
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}
