import { Bookmark, Clapperboard, Database, DownloadCloud, Film, Home, Menu, Sparkles, Tv, UserRound } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink } from 'react-router'
import { UserPanel } from '@/components/app-shell/user-panel'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useAuth } from '@/contexts/auth'
import { cn } from '@/lib/utils'

export function MobileHeader() {
  const { t } = useTranslation()
  const { isAdmin } = useAuth()
  const [open, setOpen] = useState(false)

  return (
    <header className="border-b bg-background/90 px-4 py-3 backdrop-blur lg:hidden">
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          className="-ml-2 h-11 gap-2 px-2 font-semibold text-base"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
        >
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Clapperboard className="size-4" />
          </span>
          ZME
          <Menu className="size-4 text-muted-foreground" />
        </Button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="dark w-[18rem] max-w-[82vw] gap-0 bg-sidebar p-0 text-sidebar-foreground">
          <SheetHeader className="p-5">
            <SheetTitle className="text-sidebar-foreground">
              <Link to="/" className="flex items-center gap-3" onClick={() => setOpen(false)}>
                <span className="flex size-11 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-lg shadow-sidebar-primary/30">
                  <Clapperboard className="size-5" />
                </span>
                <span>
                  <span className="block font-semibold text-xl">ZME</span>
                  <span className="block text-muted-foreground text-xs">{t('privateDesk')}</span>
                </span>
              </Link>
            </SheetTitle>
          </SheetHeader>

          <nav className="flex flex-1 flex-col gap-1 px-3">
            <MobileMenuLink icon={Home} label={t('discover')} to="/" onNavigate={() => setOpen(false)} />
            <MobileMenuLink icon={Film} label={t('movies')} to="/movies" onNavigate={() => setOpen(false)} />
            <MobileMenuLink icon={Tv} label={t('series')} to="/series" onNavigate={() => setOpen(false)} />
            <MobileMenuLink icon={Sparkles} label={t('animations')} to="/animations" onNavigate={() => setOpen(false)} />
            <MobileMenuLink icon={Bookmark} label={t('myLibrary')} to="/library" onNavigate={() => setOpen(false)} />
            <MobileMenuLink
              icon={DownloadCloud}
              label={t('downloads')}
              to="/downloads"
              onNavigate={() => setOpen(false)}
            />
            {isAdmin ? (
              <>
                <div className="py-2">
                  <Separator className="bg-sidebar-border" />
                  <div className="px-2 pt-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    {t('admin')}
                  </div>
                </div>
                <MobileMenuLink
                  icon={UserRound}
                  label={t('users')}
                  to="/admin/users"
                  onNavigate={() => setOpen(false)}
                />
                <MobileMenuLink
                  icon={Database}
                  label={t('mediaSources')}
                  to="/admin/media-sources"
                  onNavigate={() => setOpen(false)}
                />
                <MobileMenuLink
                  icon={Database}
                  label={t('indexers')}
                  to="/admin/indexers"
                  onNavigate={() => setOpen(false)}
                />
              </>
            ) : null}
          </nav>

          <div className="mt-auto p-3">
            <UserPanel placement="mobile-menu" />
          </div>
        </SheetContent>
      </Sheet>
    </header>
  )
}

function MobileMenuLink({
  icon: Icon,
  label,
  onNavigate,
  to,
}: {
  icon: typeof Home
  label: string
  onNavigate: () => void
  to: string
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex h-11 items-center gap-3 rounded-xl px-3 font-medium text-sm transition',
          isActive
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-foreground hover:bg-sidebar-accent',
        )
      }
      onClick={onNavigate}
    >
      <Icon className="size-4" />
      {label}
    </NavLink>
  )
}
