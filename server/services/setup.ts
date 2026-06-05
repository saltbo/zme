import { eq, isNull } from 'drizzle-orm'
import type { Auth } from '../auth'
import type { createDb } from '../db/client'
import { library, user } from '../db/schema'

type Db = ReturnType<typeof createDb>

export interface SetupAdminInput {
  name: string
  email: string
  password: string
}

export async function isInitialized(db: Db): Promise<boolean> {
  const rows = await db.select({ id: user.id }).from(user).limit(1)
  return rows.length > 0
}

export async function createInitialAdmin(db: Db, auth: Auth, input: SetupAdminInput) {
  if (await isInitialized(db)) {
    throw new Error('ZME has already been initialized.')
  }

  const created = await auth.api.createUser({
    body: {
      email: input.email,
      password: input.password,
      name: input.name,
      role: 'admin',
    },
  })

  await db.update(library).set({ userId: created.user.id }).where(isNull(library.userId))

  return created.user
}

export async function userExists(db: Db, userId: string): Promise<boolean> {
  const rows = await db.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1)
  return rows.length > 0
}
