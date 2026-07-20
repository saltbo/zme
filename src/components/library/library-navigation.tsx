import { BookOpen, Clapperboard, ListMusic } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router'
import { cn } from '@/lib/utils'

const sections = [
  { path: '/library/media', labelKey: 'filmAndTv', icon: Clapperboard },
  { path: '/library/books', labelKey: 'books', icon: BookOpen },
  { path: '/library/music/playlists', labelKey: 'music', icon: ListMusic },
] as const

export function LibraryNavigation({ musicKind }: { musicKind?: 'playlist' | 'album' }) {
  const { t } = useTranslation()
  const location = useLocation()
  return (
    <div className="mb-5 border-b">
      <nav className="flex gap-1 overflow-x-auto" aria-label={t('librarySections')}>
        {sections.map((section) => {
          const active = location.pathname.startsWith(section.path.replace('/playlists', ''))
          const Icon = section.icon
          return (
            <Link
              key={section.path}
              to={section.path}
              className={cn(
                'flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground',
                active && 'border-primary text-foreground',
              )}
            >
              <Icon className="size-4" />
              {t(section.labelKey)}
            </Link>
          )
        })}
      </nav>
      {musicKind ? (
        <nav className="flex gap-2 py-3" aria-label={t('musicLibrarySections')}>
          <Link
            to="/library/music/playlists"
            className={cn(
              'rounded-full px-3 py-1.5 font-medium text-muted-foreground text-sm hover:bg-muted hover:text-foreground',
              musicKind === 'playlist' && 'bg-primary/10 text-primary',
            )}
          >
            {t('playlists')}
          </Link>
          <Link
            to="/library/music/albums"
            className={cn(
              'rounded-full px-3 py-1.5 font-medium text-muted-foreground text-sm hover:bg-muted hover:text-foreground',
              musicKind === 'album' && 'bg-primary/10 text-primary',
            )}
          >
            {t('albums')}
          </Link>
        </nav>
      ) : null}
    </div>
  )
}
