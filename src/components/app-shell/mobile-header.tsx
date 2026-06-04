import { Clapperboard, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function MobileHeader() {
  const { t } = useTranslation()

  return (
    <header className="border-b bg-background/90 px-4 py-3 backdrop-blur lg:hidden">
      <div className="flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Clapperboard className="size-4" />
          </span>
          ZME
        </Link>
        <Badge variant="outline" className="h-8 gap-2">
          <ShieldCheck className="size-4" />
          Private
        </Badge>
      </div>
      <nav className="mt-3 grid grid-cols-5 gap-2">
        <MobileNavLink label={t('discover')} to="/" />
        <MobileNavLink label={t('movies')} to="/movies" />
        <MobileNavLink label={t('series')} to="/series" />
        <MobileNavLink label={t('favorites')} to="/favorites" />
        <MobileNavLink label={t('downloads')} to="/downloads" />
      </nav>
    </header>
  )
}

function MobileNavLink({ label, to }: { label: string; to: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(buttonVariants({ variant: isActive ? 'default' : 'outline', size: 'lg' }), 'h-10 rounded-full')
      }
    >
      {label}
    </NavLink>
  )
}
