import { createUsersRepo } from '../adapters/repos/users'
import type { Auth } from '../auth'
import type { createDb } from '../db/client'

type Db = ReturnType<typeof createDb>

export interface SetupAdminInput {
  name: string
  email: string
  password: string
}

export async function isInitialized(db: Db): Promise<boolean> {
  return createUsersRepo(db).isInitialized()
}

export async function createInitialAdmin(db: Db, auth: Auth, input: SetupAdminInput) {
  const repo = createUsersRepo(db)
  if (await repo.isInitialized()) {
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

  await repo.adoptOrphanLibraryItems(created.user.id)

  return created.user
}
