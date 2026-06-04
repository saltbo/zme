import type { CSSProperties } from 'react'
import { useState } from 'react'
import { Outlet } from 'react-router'
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
        <AppTopbar override={topbarOverride} />
        <Outlet context={{ setTopbarOverride }} />
      </SidebarInset>
    </SidebarProvider>
  )
}
