import type { createDb } from '@server/db/client'
import { applicationSessions, dpopReplays, oidcLoginTransactions, user } from '@server/db/schema'
import {
  type AuthenticatedUser,
  IdentityDisabledError,
  type IdentityRepo,
  type LoginTransaction,
} from '@server/usecases/identity'
import { and, eq, gt, isNull, lt } from 'drizzle-orm'

type Db = ReturnType<typeof createDb>

export function createIdentityRepo(db: Db): IdentityRepo {
  return {
    async createLoginTransaction(transaction) {
      await db.delete(oidcLoginTransactions).where(lt(oidcLoginTransactions.expiresAt, transaction.createdAt))
      await db.insert(oidcLoginTransactions).values(transaction)
    },

    async consumeLoginTransaction(stateHash, now) {
      const rows = await db
        .delete(oidcLoginTransactions)
        .where(and(eq(oidcLoginTransactions.stateHash, stateHash), gt(oidcLoginTransactions.expiresAt, now)))
        .returning()
      return (rows[0] as LoginTransaction | undefined) ?? null
    },

    async resolveUser(profile, bindingLegacyUserId, configuredAdmin, refreshProfile, now) {
      const existing = await db
        .select()
        .from(user)
        .where(and(eq(user.issuer, profile.issuer), eq(user.subject, profile.subject)))
        .limit(1)
      if (existing[0]) {
        if (existing[0].disabled) throw new IdentityDisabledError()
        const role = configuredAdmin ? 'admin' : 'user'
        const updated = await db
          .update(user)
          .set({
            ...(refreshProfile ? { name: profile.name, email: profile.email, image: profile.image } : {}),
            role,
            updatedAt: new Date(now),
          })
          .where(eq(user.id, existing[0].id))
          .returning()
        return mapUser(updated[0])
      }

      if (bindingLegacyUserId) {
        const bound = await db
          .update(user)
          .set({
            issuer: profile.issuer,
            subject: profile.subject,
            identityBoundAt: now,
            ...(refreshProfile ? { name: profile.name, email: profile.email, image: profile.image } : {}),
            role: configuredAdmin ? 'admin' : 'user',
            updatedAt: new Date(now),
          })
          .where(and(eq(user.id, bindingLegacyUserId), isNull(user.issuer), isNull(user.subject)))
          .returning()
        if (!bound[0])
          throw new Error(`Configured legacy identity binding target ${bindingLegacyUserId} is unavailable.`)
        return mapUser(bound[0])
      }

      const id = crypto.randomUUID()
      const created = await db
        .insert(user)
        .values({
          id,
          issuer: profile.issuer,
          subject: profile.subject,
          identityBoundAt: now,
          name: profile.name,
          email: profile.email,
          image: profile.image,
          role: configuredAdmin ? 'admin' : 'user',
          createdAt: new Date(now),
          updatedAt: new Date(now),
        })
        .returning()
      return mapUser(created[0])
    },

    async createSession(session) {
      await db.delete(applicationSessions).where(lt(applicationSessions.expiresAt, session.createdAt))
      await db.insert(applicationSessions).values(session)
    },

    async getSession(tokenHash, now) {
      const rows = await db
        .select({ session: applicationSessions, user })
        .from(applicationSessions)
        .innerJoin(user, eq(applicationSessions.userId, user.id))
        .where(and(eq(applicationSessions.tokenHash, tokenHash), gt(applicationSessions.expiresAt, now)))
        .limit(1)
      const row = rows[0]
      if (!row || row.user.disabled || !row.user.issuer || !row.user.subject) return null
      return {
        id: row.session.id,
        expiresAt: row.session.expiresAt,
        user: mapUser(row.user),
      }
    },

    async deleteSession(tokenHash) {
      await db.delete(applicationSessions).where(eq(applicationSessions.tokenHash, tokenHash))
    },

    async recordDpopProof(issuer, proofJti, keyThumbprint, expiresAt, now) {
      await db.delete(dpopReplays).where(lt(dpopReplays.expiresAt, now))
      const inserted = await db
        .insert(dpopReplays)
        .values({ issuer, proofJti, keyThumbprint, expiresAt, createdAt: now })
        .onConflictDoNothing()
        .returning({ proofJti: dpopReplays.proofJti })
      return inserted.length === 1
    },
  }
}

function mapUser(row: typeof user.$inferSelect): AuthenticatedUser {
  if (!row.issuer || !row.subject) throw new Error('An unbound legacy user cannot authenticate.')
  return {
    id: row.id,
    issuer: row.issuer,
    subject: row.subject,
    name: row.name,
    email: row.email,
    image: row.image,
    role: row.role === 'admin' ? 'admin' : 'user',
  }
}
