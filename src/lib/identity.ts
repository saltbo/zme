import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

export interface SessionUser {
  id: string
  issuer: string
  subject: string
  name: string
  email: string | null
  image: string | null
  role: 'admin' | 'user'
}

const sessionSchema = z
  .object({
    user: z
      .object({
        id: z.string().min(1),
        issuer: z.string().url(),
        subject: z.string().min(1),
        name: z.string(),
        email: z.string().email().nullable(),
        image: z.string().url().nullable(),
        role: z.enum(['admin', 'user']),
      })
      .strict()
      .nullable(),
    expiresAt: z.string().datetime().optional(),
  })
  .strict()

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
  return sessionSchema.parse(await response.json())
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
