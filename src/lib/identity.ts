import { useQuery } from '@tanstack/react-query'

export interface SessionUser {
  id: string
  issuer: string
  subject: string
  name: string
  email: string | null
  image: string | null
  role: 'admin' | 'user'
}

export function useSession() {
  return useQuery({
    queryKey: ['identity-session'],
    queryFn: getSession,
    staleTime: 30_000,
    retry: false,
  })
}

export async function getSession(): Promise<{ user: SessionUser | null; expiresAt?: string }> {
  const response = await fetch('/auth/session', { credentials: 'include' })
  if (!response.ok) throw new Error('Failed to load the application session.')
  return response.json() as Promise<{ user: SessionUser | null; expiresAt?: string }>
}

export async function signOut(): Promise<string> {
  const response = await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
  if (!response.ok) throw new Error('Failed to sign out.')
  const body = (await response.json()) as { redirectTo: string }
  return body.redirectTo
}

export function loginUrl(returnTo: string): string {
  return `/auth/login?${new URLSearchParams({ returnTo }).toString()}`
}
