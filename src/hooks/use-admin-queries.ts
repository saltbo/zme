import { useQuery } from '@tanstack/react-query'
import { listDownloaders, listIndexers, listMediaSources } from '@/lib/api'
import { authClient } from '@/lib/auth-client'
import { queryKeys } from '@/lib/query-keys'

export interface ManagedUser {
  id: string
  name: string
  email: string
  role?: string | null
  banned?: boolean | null
  createdAt?: string | Date
}

export function useDownloaders() {
  return useQuery({
    queryKey: queryKeys.downloaders,
    queryFn: async () => (await listDownloaders()).items,
  })
}

export function useIndexers() {
  return useQuery({
    queryKey: queryKeys.indexers,
    queryFn: async () => (await listIndexers()).items,
  })
}

export function useMediaSources() {
  return useQuery({
    queryKey: queryKeys.mediaSources,
    queryFn: async () => (await listMediaSources()).items,
  })
}

export function useManagedUsers() {
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: async () => {
      const [usersResult, sessionResult] = await Promise.all([
        authClient.admin.listUsers({ query: { limit: 100, offset: 0 } }),
        authClient.getSession(),
      ])
      if (usersResult.error) throw new Error(usersResult.error.message || 'Failed to load users.')

      return {
        users: (usersResult.data?.users ?? []) as ManagedUser[],
        currentUserId: sessionResult.data?.user.id ?? null,
      }
    },
  })
}
