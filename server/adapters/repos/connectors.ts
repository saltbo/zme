import type { createDb } from '@server/db/client'
import { connectors } from '@server/db/schema'
import type { ConnectorRecord, ConnectorsRepo } from '@server/usecases/ports'
import type { ConnectorSyncResult } from '@shared/types'
import { and, eq } from 'drizzle-orm'

type Db = ReturnType<typeof createDb>

export function createConnectorsRepo(db: Db): ConnectorsRepo {
  async function findByKind(userId: string, kind: ConnectorRecord['kind']): Promise<ConnectorRecord | null> {
    const rows = await db
      .select()
      .from(connectors)
      .where(and(eq(connectors.userId, userId), eq(connectors.kind, kind)))
      .limit(1)
    return rows[0] ? toRecord(rows[0]) : null
  }

  return {
    async list(userId) {
      return (await db.select().from(connectors).where(eq(connectors.userId, userId))).map(toRecord)
    },

    async get(userId, id) {
      const rows = await db
        .select()
        .from(connectors)
        .where(and(eq(connectors.userId, userId), eq(connectors.id, id)))
        .limit(1)
      return rows[0] ? toRecord(rows[0]) : null
    },

    async findByKind(userId, kind) {
      return findByKind(userId, kind)
    },

    async listEnabled() {
      return (await db.select().from(connectors).where(eq(connectors.enabled, true))).map(toRecord)
    },

    async save(userId, kind, input) {
      const now = new Date().toISOString()
      const existing = await findByKind(userId, kind)
      if (existing) {
        const rows = await db
          .update(connectors)
          .set({
            externalAccountId: input.externalAccountId,
            displayName: input.displayName,
            avatarUrl: input.avatarUrl,
            settingsJson: JSON.stringify(input.settings),
            credentialsEncrypted: input.credentialsEncrypted,
            status: input.status,
            enabled: input.enabled,
            lastError: null,
            updatedAt: now,
          })
          .where(eq(connectors.id, existing.id))
          .returning()
        return toRecord(rows[0])
      }

      const row = {
        id: crypto.randomUUID(),
        userId,
        kind,
        externalAccountId: input.externalAccountId,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl,
        settingsJson: JSON.stringify(input.settings),
        credentialsEncrypted: input.credentialsEncrypted,
        status: input.status,
        enabled: input.enabled,
        lastSyncedAt: null,
        lastError: null,
        lastResultJson: null,
        createdAt: now,
        updatedAt: now,
      }
      await db.insert(connectors).values(row)
      return toRecord(row)
    },

    async updateState(userId, id, input) {
      const rows = await db
        .update(connectors)
        .set({ ...input, updatedAt: new Date().toISOString() })
        .where(and(eq(connectors.userId, userId), eq(connectors.id, id)))
        .returning()
      return rows[0] ? toRecord(rows[0]) : null
    },

    async delete(userId, id) {
      const rows = await db
        .delete(connectors)
        .where(and(eq(connectors.userId, userId), eq(connectors.id, id)))
        .returning({ id: connectors.id })
      return rows.length > 0
    },

    async markSynced(id, result, error) {
      const now = new Date().toISOString()
      await db
        .update(connectors)
        .set({
          ...(result
            ? { lastSyncedAt: now, lastResultJson: JSON.stringify(result), status: 'connected' as const }
            : { status: 'error' as const }),
          lastError: error,
          updatedAt: now,
        })
        .where(eq(connectors.id, id))
    },
  }
}

function toRecord(row: typeof connectors.$inferSelect): ConnectorRecord {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    externalAccountId: row.externalAccountId,
    displayName: row.displayName || row.externalAccountId,
    avatarUrl: row.avatarUrl,
    settings: JSON.parse(row.settingsJson) as Record<string, string>,
    credentialsEncrypted: row.credentialsEncrypted,
    status: row.status,
    enabled: row.enabled,
    lastSyncedAt: row.lastSyncedAt,
    lastError: row.lastError,
    lastResult: row.lastResultJson ? (JSON.parse(row.lastResultJson) as ConnectorSyncResult) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
