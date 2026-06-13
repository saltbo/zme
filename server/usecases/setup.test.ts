import { describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import { createInitialAdmin } from './setup'

function createDeps(initialized: boolean) {
  const adopted: string[] = []
  const deps = {
    usersRepo: {
      isInitialized: async () => initialized,
      adoptOrphanLibraryItems: async (userId: string) => {
        adopted.push(userId)
      },
    },
  }
  return { deps: deps as never as Deps, adopted }
}

describe('createInitialAdmin', () => {
  it('refuses to run twice', async () => {
    const { deps } = createDeps(true)
    const createAdminUser = vi.fn()

    await expect(
      createInitialAdmin(deps, createAdminUser, { name: 'A', email: 'a@b.c', password: 'pw' }),
    ).rejects.toThrow('ZME has already been initialized.')
    expect(createAdminUser).not.toHaveBeenCalled()
  })

  it('creates the admin role account and adopts orphaned library rows', async () => {
    const { deps, adopted } = createDeps(false)
    const createAdminUser = vi.fn(async () => ({ id: 'admin-1', email: 'a@b.c' }))

    const user = await createInitialAdmin(deps, createAdminUser, { name: 'A', email: 'a@b.c', password: 'pw' })

    expect(createAdminUser).toHaveBeenCalledWith({ name: 'A', email: 'a@b.c', password: 'pw', role: 'admin' })
    expect(adopted).toEqual(['admin-1'])
    expect(user).toEqual({ id: 'admin-1', email: 'a@b.c' })
  })
})
