import { createContext, useContext } from 'react'
import type { authClient } from '@/lib/auth-client'

type SessionData = typeof authClient.$Infer.Session

interface AuthContextValue {
  user: SessionData['user']
  isAdmin: boolean
  refreshSession: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('AuthProvider is missing.')
  return context
}

export function isAdminUser(user: { role?: string | null }) {
  return (user.role || '').split(',').includes('admin')
}
