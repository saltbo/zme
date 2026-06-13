import type { Deps } from './deps'

export interface SetupAdminInput {
  name: string
  email: string
  password: string
}

export async function isInitialized(deps: Deps): Promise<boolean> {
  return deps.usersRepo.isInitialized()
}

/**
 * Creates the first administrator. `createAdminUser` is supplied by the
 * delivery layer because account creation is bound to the incoming request
 * (auth base URL); everything around it is the business rule.
 */
export async function createInitialAdmin<User extends { id: string }>(
  deps: Deps,
  createAdminUser: (input: SetupAdminInput & { role: 'admin' }) => Promise<User>,
  input: SetupAdminInput,
): Promise<User> {
  if (await deps.usersRepo.isInitialized()) {
    throw new Error('ZME has already been initialized.')
  }

  const user = await createAdminUser({ ...input, role: 'admin' })
  await deps.usersRepo.adoptOrphanLibraryItems(user.id)

  return user
}
