import type { createDb } from '@server/db/client'
import { connectorLoginAttempts } from '@server/db/schema'
import type { ConnectorLoginAttemptsRepo } from '@server/usecases/ports'
import { and, eq } from 'drizzle-orm'

type Db = ReturnType<typeof createDb>

export function createConnectorLoginAttemptsRepo(db: Db): ConnectorLoginAttemptsRepo {
  return {
    async create(record) {
      await db.insert(connectorLoginAttempts).values(record)
    },

    async get(userId, id) {
      const rows = await db
        .select()
        .from(connectorLoginAttempts)
        .where(and(eq(connectorLoginAttempts.userId, userId), eq(connectorLoginAttempts.id, id)))
        .limit(1)
      return rows[0] ?? null
    },

    async update(userId, id, patch) {
      const rows = await db
        .update(connectorLoginAttempts)
        .set(patch)
        .where(and(eq(connectorLoginAttempts.userId, userId), eq(connectorLoginAttempts.id, id)))
        .returning()
      return rows[0] ?? null
    },
  }
}
