import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { cn } from '@/lib/utils'

export function MusicLibraryNavigation({ kind, count }: { kind: 'playlist' | 'album'; count: number }) {
  const { t } = useTranslation()

  return (
    <div className="mb-5 flex min-h-12 items-center justify-between gap-4 border-b pb-3">
      <nav className="flex min-w-0 items-center gap-1" aria-label={t('musicLibrarySections')}>
        <Link
          to="/library/music/playlists"
          aria-current={kind === 'playlist' ? 'page' : undefined}
          className={cn(
            'flex min-h-10 items-center rounded-lg px-3 font-medium text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            kind === 'playlist' && 'bg-primary/10 text-primary',
          )}
        >
          {t('playlists')}
        </Link>
        <Link
          to="/library/music/albums"
          aria-current={kind === 'album' ? 'page' : undefined}
          className={cn(
            'flex min-h-10 items-center rounded-lg px-3 font-medium text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            kind === 'album' && 'bg-primary/10 text-primary',
          )}
        >
          {t('albums')}
        </Link>
      </nav>
      <span className="shrink-0 text-muted-foreground text-sm tabular-nums">{t('collectionCount', { count })}</span>
    </div>
  )
}
