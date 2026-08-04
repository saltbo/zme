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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
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
              <div className="font-semibold text-xl">ZME</div>
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
            <LibrarySidebarMenu />
            <SidebarLink icon={DownloadCloud} label={t('downloads')} to="/downloads" />
            {isAdmin ? (
              <>
                <SidebarMenuItem className="py-2">
                  <Separator className="bg-sidebar-border" />
                  <div className="px-2 pt-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    {t('admin')}
                  </div>
                </SidebarMenuItem>
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

function LibrarySidebarMenu() {
  const { t } = useTranslation()
  const location = useLocation()
  const sections = [
    { icon: Clapperboard, label: t('filmAndTv'), to: '/library/media' },
    { icon: BookOpen, label: t('books'), to: '/library/books' },
    { icon: Disc3, label: t('music'), to: '/library/music' },
  ]

  return (
    <SidebarMenuItem>
      <div className="flex h-10 items-center gap-2 px-2 font-medium text-sidebar-foreground/72 text-sm">
        <Bookmark className="size-4 shrink-0" />
        <span>{t('myLibrary')}</span>
      </div>
      <SidebarMenuSub className="py-1">
        {sections.map(({ icon: Icon, label, to }) => (
          <SidebarMenuSubItem key={to}>
            <SidebarMenuSubButton
              render={<NavLink to={to} />}
              isActive={location.pathname === to || location.pathname.startsWith(`${to}/`)}
              className="relative h-10 rounded-md text-sidebar-foreground/68 before:absolute before:-left-[11px] before:h-5 before:w-0.5 before:rounded-full before:bg-transparent data-active:bg-transparent data-active:font-semibold data-active:text-sidebar-foreground data-active:before:bg-sidebar-primary data-active:[&>svg]:text-sidebar-primary [&>svg]:text-sidebar-foreground/55"
            >
              <Icon />
              <span>{label}</span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        ))}
      </SidebarMenuSub>
    </SidebarMenuItem>
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
  const isActive = !muted && (location.pathname === to || (to !== '/' && location.pathname.startsWith(`${to}/`)))

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
