import { ArrowLeft } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useOutletContext, useParams } from 'react-router'
import { MediaWall } from '@/components/media/media-components'
import type { AppOutletContext } from '@/components/app-shell/types'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { usePersonCredits } from '@/hooks/use-media-queries'
import { getTmdbLanguage } from '@/i18n'
import { cn } from '@/lib/utils'

export function PersonCreditsPage() {
  const { id } = useParams()
  const location = useLocation()
  const { setTopbarOverride } = useOutletContext<AppOutletContext>()
  const { i18n, t } = useTranslation()
  const personId = Number(id)
  const credits = usePersonCredits(personId, getTmdbLanguage(i18n.language))
  const person = credits.data?.person ?? null
  const results = credits.data?.results ?? []

  useEffect(() => {
    if (!person) return

    setTopbarOverride({
      pathname: location.pathname,
      title: person.name,
      subtitle: t('personCreditsSubtitle', { count: results.length }),
    })

    return () => setTopbarOverride(null)
  }, [location.pathname, person, results.length, setTopbarOverride, t])

  if (!Number.isInteger(personId) || personId <= 0) {
    return (
      <div className="mx-auto w-full min-w-0 max-w-[1520px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
        <Card className="flex min-h-80 items-center justify-center p-8 text-muted-foreground">
          {t('invalidPersonRoute')}
        </Card>
      </div>
    )
  }

  if (credits.isLoading) {
    return (
      <div className="mx-auto w-full min-w-0 max-w-[1520px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
        <Skeleton className="h-44 rounded-xl" />
        <div className="mt-6">
          <MediaWall items={[]} loading />
        </div>
      </div>
    )
  }

  if (credits.isError || !person) {
    return (
      <div className="mx-auto w-full min-w-0 max-w-[1520px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
        <Card className="flex min-h-80 items-center justify-center p-8 text-muted-foreground">
          {credits.error instanceof Error ? credits.error.message : t('unableToLoadPersonCredits')}
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1520px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <section className="mb-6 flex min-w-0 items-center gap-4 rounded-xl border bg-card p-4 sm:p-5">
        <Link
          to={location.state?.from ?? '..'}
          relative={location.state?.from ? undefined : 'path'}
          aria-label="Back"
          className={cn(buttonVariants({ variant: 'secondary', size: 'icon-lg' }), 'shrink-0 rounded-full')}
        >
          <ArrowLeft />
        </Link>
        <div className="size-20 shrink-0 overflow-hidden rounded-xl bg-muted sm:size-24">
          {person.portraitUrl ? (
            <img src={person.portraitUrl} alt={person.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground text-xs">
              {t('noPortrait')}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <h1 className="line-clamp-2 font-semibold text-xl leading-tight sm:text-3xl">{person.name}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t('personCreditsSubtitle', { count: results.length })}</p>
        </div>
      </section>

      {results.length > 0 ? (
        <MediaWall items={results} loading={false} />
      ) : (
        <Card className="flex min-h-80 items-center justify-center p-8 text-muted-foreground">
          {t('noPersonCredits')}
        </Card>
      )}
    </div>
  )
}
