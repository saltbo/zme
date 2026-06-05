import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { toast } from 'sonner'
import { FullPageLoading } from '@/components/app-shell/full-page-loading'
import { AuthContext, isAdminUser } from '@/contexts/auth'
import { LibraryProvider } from '@/contexts/library'
import { getSetupStatus } from '@/lib/api'
import { authClient } from '@/lib/auth-client'
import { queryKeys } from '@/lib/query-keys'
import { LoginPage } from '@/routes/login'
import { OnboardingPage } from '@/routes/onboarding'

export function AuthGate() {
  const location = useLocation()
  const session = authClient.useSession()
  const setupStatus = useQuery({
    queryKey: queryKeys.setupStatus,
    queryFn: getSetupStatus,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const initialized = setupStatus.error ? true : setupStatus.data?.initialized

  useEffect(() => {
    if (setupStatus.error) {
      toast.error(setupStatus.error instanceof Error ? setupStatus.error.message : 'Setup status failed.')
    }
  }, [setupStatus.error])

  if (initialized === undefined || session.isPending) {
    return <FullPageLoading />
  }

  if (!initialized) {
    if (location.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />
    return (
      <OnboardingPage
        onComplete={async () => {
          await setupStatus.refetch()
          await session.refetch()
        }}
      />
    )
  }

  if (location.pathname === '/onboarding') {
    return <Navigate to="/" replace />
  }

  if (!session.data) {
    if (location.pathname !== '/login') return <Navigate to="/login" replace state={{ from: location.pathname }} />
    return <LoginPage onSignedIn={() => session.refetch()} />
  }

  if (location.pathname === '/login') {
    return <Navigate to="/" replace />
  }

  const authValue = {
    user: session.data.user,
    isAdmin: isAdminUser(session.data.user),
    refreshSession: () => session.refetch(),
  }

  return (
    <AuthContext.Provider value={authValue}>
      <LibraryProvider>
        <Outlet />
      </LibraryProvider>
    </AuthContext.Provider>
  )
}
