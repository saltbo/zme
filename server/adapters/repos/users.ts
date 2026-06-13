import type { createDb } from '@server/db/client'
import { library, user } from '@server/db/schema'
import type { UsersRepo } from '@server/usecases/ports'
import { isNull } from 'drizzle-orm'

type Db = ReturnType<typeof createDb>

export function createUsersRepo(db: Db): UsersRepo {
  return {
    async isInitialized() {
      const rows = await db.select({ id: user.id }).from(user).limit(1)
      return rows.length > 0
    },

    async adoptOrphanLibraryItems(userId) {
      await db.update(library).set({ userId }).where(isNull(library.userId))
    },
  }
}
