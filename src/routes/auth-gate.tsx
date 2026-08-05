import { Navigate, Outlet, useLocation } from 'react-router'
import { FullPageLoading } from '@/components/app-shell/full-page-loading'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AuthContext, isAdminUser } from '@/contexts/auth'
import { LibraryProvider } from '@/contexts/library'
import { useSession } from '@/lib/identity'
import { LoginPage } from '@/routes/login'

export function AuthGate() {
  const location = useLocation()
  const session = useSession()
  if (session.isPending) return <FullPageLoading />
  if (session.isError) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
        <Card className="w-full max-w-sm space-y-4 p-6" role="alert">
          <div>
            <h1 className="font-semibold text-lg">Session unavailable</h1>
            <p className="text-muted-foreground text-sm">
              ZME could not verify your application session. Your sign-in state was not changed.
            </p>
          </div>
          <Button type="button" onClick={() => session.refetch()}>
            Try again
          </Button>
        </Card>
      </main>
    )
  }
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
