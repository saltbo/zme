import type { createDb } from '@server/db/client'
import { connectorLoginAttempts } from '@server/db/schema'
import type { ConnectorLoginAttemptsRepo } from '@server/usecases/ports'
import { and, eq } from 'drizzle-orm'

type Db = ReturnType<typeof createDb>

export function createConnectorLoginAttemptsRepo(db: Db): ConnectorLoginAttemptsRepo {
  return {
    async create(record) {
      const { challenge, ...values } = record
      await db.insert(connectorLoginAttempts).values({
        ...values,
        challengeJson: challenge ? JSON.stringify(challenge) : null,
      })
    },

    async get(userId, id) {
      const rows = await db
        .select()
        .from(connectorLoginAttempts)
        .where(and(eq(connectorLoginAttempts.userId, userId), eq(connectorLoginAttempts.id, id)))
        .limit(1)
      return rows[0] ? toRecord(rows[0]) : null
    },

    async update(userId, id, patch) {
      const { challenge, ...values } = patch
      const rows = await db
        .update(connectorLoginAttempts)
        .set({
          ...values,
          ...(challenge === undefined ? {} : { challengeJson: challenge ? JSON.stringify(challenge) : null }),
        })
        .where(and(eq(connectorLoginAttempts.userId, userId), eq(connectorLoginAttempts.id, id)))
        .returning()
      return rows[0] ? toRecord(rows[0]) : null
    },
  }
}

function toRecord(row: typeof connectorLoginAttempts.$inferSelect) {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    method: row.method,
    stateEncrypted: row.stateEncrypted,
    challenge: row.challengeJson ? JSON.parse(row.challengeJson) : null,
    status: row.status,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
