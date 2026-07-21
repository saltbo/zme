import type { createDb } from '@server/db/client'
import { musicDownloadKeys } from '@server/db/schema'
import type { MusicDownloadKeysRepo } from '@server/usecases/ports'
import { eq } from 'drizzle-orm'

type Db = ReturnType<typeof createDb>

export function createMusicDownloadKeysRepo(db: Db): MusicDownloadKeysRepo {
  return {
    async create(record) {
      await db.insert(musicDownloadKeys).values(record)
    },

    async getByHash(keyHash) {
      const rows = await db.select().from(musicDownloadKeys).where(eq(musicDownloadKeys.keyHash, keyHash)).limit(1)
      return rows[0] ?? null
    },

    async revoke(id, revokedAt) {
      await db.update(musicDownloadKeys).set({ revokedAt }).where(eq(musicDownloadKeys.id, id))
    },
  }
}
