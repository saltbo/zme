import type { CSSProperties } from 'react'
import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigationType } from 'react-router'
import { AppSidebar } from '@/components/app-shell/app-sidebar'
import { AppTopbar } from '@/components/app-shell/app-topbar'
import { MobileHeader } from '@/components/app-shell/mobile-header'
import type { TopbarOverride } from '@/components/app-shell/types'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

export function AuthenticatedShell() {
  const [topbarOverride, setTopbarOverride] = useState<TopbarOverride | null>(null)

  return (
    <SidebarProvider style={{ '--sidebar-width': '17.5rem' } as CSSProperties}>
      <AppSidebar />
      <SidebarInset className="min-h-dvh min-w-0 basis-0 bg-muted/40 text-foreground">
        <MobileHeader />
        <ScrollToTop />
        <AppTopbar override={topbarOverride} />
        <Outlet context={{ setTopbarOverride }} />
      </SidebarInset>
    </SidebarProvider>
  )
}

function ScrollToTop() {
  const location = useLocation()
  const navigationType = useNavigationType()

  useEffect(() => {
    if (navigationType === 'POP' || !location.key) return
    window.scrollTo({ top: 0, left: 0 })
  }, [location.key, navigationType])

  return null
}
