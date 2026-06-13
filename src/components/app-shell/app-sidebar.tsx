import {
  Bookmark,
  BookOpen,
  Clapperboard,
  Database,
  Disc3,
  DownloadCloud,
  Film,
  Home,
  Sparkles,
  Tv,
  UserRound,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, useLocation } from 'react-router'
import { UserPanel } from '@/components/app-shell/user-panel'
import { Separator } from '@/components/ui/separator'
import {
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  Sidebar as SidebarRoot,
} from '@/components/ui/sidebar'
import { useAuth } from '@/contexts/auth'
import { cn } from '@/lib/utils'

export function AppSidebar() {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()

  return (
    <div className="hidden lg:block">
      <SidebarRoot collapsible="offcanvas" className="dark border-sidebar-border border-r">
        <SidebarHeader className="p-5">
          <Link to="/" className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-lg shadow-sidebar-primary/30">
              <Clapperboard className="size-5" />
            </span>
            <div>
              <div className="font-semibold text-xl">Curarr</div>
              <div className="text-muted-foreground text-xs">{t('privateDesk')}</div>
            </div>
          </Link>
        </SidebarHeader>

        <SidebarContent className="px-3">
          <SidebarMenu>
            <SidebarLink icon={Home} label={t('discover')} to="/" />
            <SidebarLink icon={Film} label={t('movies')} to="/movies" />
            <SidebarLink icon={Tv} label={t('series')} to="/series" />
            <SidebarLink icon={Sparkles} label={t('animations')} to="/animations" />
            <SidebarLink icon={Disc3} label={t('music')} to="/music" />
            <SidebarLink icon={BookOpen} label={t('books')} to="/books" />
            <SidebarLink icon={Bookmark} label={t('myLibrary')} to="/library" />
            <SidebarLink icon={DownloadCloud} label={t('downloads')} to="/downloads" />
            {isAdmin ? (
              <>
                <SidebarMenuItem className="py-2">
                  <Separator className="bg-sidebar-border" />
                  <div className="px-2 pt-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    {t('admin')}
                  </div>
                </SidebarMenuItem>
                <SidebarLink icon={UserRound} label={t('users')} to="/admin/users" />
                <SidebarLink icon={Database} label={t('mediaSources')} to="/admin/media-sources" />
                <SidebarLink icon={Database} label={t('indexers')} to="/admin/indexers" />
              </>
            ) : null}
          </SidebarMenu>
        </SidebarContent>

        <SidebarFooter className="mt-auto p-3">
          <UserPanel />
        </SidebarFooter>
      </SidebarRoot>
    </div>
  )
}

function SidebarLink({
  icon: Icon,
  label,
  to,
  muted,
}: {
  icon: typeof Home
  label: string
  to: string
  muted?: boolean
}) {
  const location = useLocation()
  const isActive = !muted && location.pathname === to

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<NavLink to={to} />}
        isActive={isActive}
        size="lg"
        tooltip={label}
        className={cn('h-11 rounded-xl', muted && 'opacity-55')}
      >
        <Icon />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
