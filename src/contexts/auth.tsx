import { createContext, useContext } from 'react'
import type { SessionUser } from '@/lib/identity'

interface AuthContextValue {
  user: SessionUser
  isAdmin: boolean
  refreshSession: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('AuthProvider is missing.')
  return context
}

export function isAdminUser(user: { role: string }) {
  return user.role === 'admin'
}
