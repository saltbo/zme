import { Navigate, Outlet, useLocation } from 'react-router'
import { FullPageLoading } from '@/components/app-shell/full-page-loading'
import { AuthContext, isAdminUser } from '@/contexts/auth'
import { LibraryProvider } from '@/contexts/library'
import { useSession } from '@/lib/identity'
import { LoginPage } from '@/routes/login'

export function AuthGate() {
  const location = useLocation()
  const session = useSession()
  if (session.isPending) return <FullPageLoading />
  const user = session.data?.user
  if (!user) {
    if (location.pathname !== '/login') return <Navigate to="/login" replace state={{ from: location.pathname }} />
    return <LoginPage />
  }
  if (location.pathname === '/login') return <Navigate to="/" replace />
  return (
    <AuthContext.Provider
      value={{
        user,
        isAdmin: isAdminUser(user),
        refreshSession: async () => {
          await session.refetch()
        },
      }}
    >
      <LibraryProvider>
        <Outlet />
      </LibraryProvider>
    </AuthContext.Provider>
  )
}
