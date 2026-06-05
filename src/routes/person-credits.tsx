import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useOutletContext, useParams } from 'react-router'
import { MediaWall } from '@/components/media/media-components'
import type { AppOutletContext } from '@/components/app-shell/types'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { usePersonCredits } from '@/hooks/use-media-queries'
import { getTmdbLanguage } from '@/i18n'

export function PersonCreditsPage() {
  const { id } = useParams()
  const location = useLocation()
  const { setTopbarOverride } = useOutletContext<AppOutletContext>()
  const { i18n, t } = useTranslation()
  const personId = Number(id)
  const credits = usePersonCredits(personId, getTmdbLanguage(i18n.language))
  const person = credits.data?.person ?? null
  const results = credits.data?.results ?? []
  const backTo = getBackTo(location.state)
  const [bioExpanded, setBioExpanded] = useState(false)

  useEffect(() => {
    if (!person) return

    setTopbarOverride({
      pathname: location.pathname,
      title: person.name,
      subtitle: t('personCreditsSubtitle', { count: results.length }),
      backTo,
    })

    return () => setTopbarOverride(null)
  }, [backTo, location.pathname, person, results.length, setTopbarOverride, t])

  useEffect(() => {
    setBioExpanded(false)
  }, [personId])

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

  const lifeDates = [person.birthday, person.deathday].filter(Boolean).join(' - ')
  const facts = [
    person.knownForDepartment ? { label: t('knownFor'), value: person.knownForDepartment } : null,
    lifeDates ? { label: t('lifeDates'), value: lifeDates } : null,
    person.placeOfBirth ? { label: t('placeOfBirth'), value: person.placeOfBirth } : null,
  ].filter((item): item is { label: string; value: string } => item !== null)
  const bioText = person.biography || t('noPersonBiography')
  const canToggleBio = Boolean(person.biography && person.biography.length > 180)

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1520px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
      <section className="mb-6 overflow-hidden rounded-[24px] bg-[#130d1f] text-white shadow-[0_22px_60px_rgba(33,22,47,0.24)] ring-1 ring-white/10 lg:hidden">
        <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-4 p-4 sm:grid-cols-[164px_minmax(0,1fr)] sm:gap-5 sm:p-5">
          <div className="overflow-hidden rounded-[18px] bg-white/8 shadow-[0_18px_40px_rgba(0,0,0,0.34)] ring-1 ring-white/12">
            {person.portraitUrl ? (
              <img src={person.portraitUrl} alt={person.name} className="aspect-[2/3] w-full object-cover" />
            ) : (
              <div className="flex aspect-[2/3] w-full items-center justify-center text-white/50 text-xs">
                {t('noPortrait')}
              </div>
            )}
          </div>
          <div className="min-w-0 self-center">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/12 px-2.5 py-1 font-medium text-white/72 text-xs">
                {t('personCreditsSubtitle', { count: results.length })}
              </span>
              {person.knownForDepartment ? (
                <span className="rounded-full bg-[#8b5cf6]/30 px-2.5 py-1 font-medium text-white text-xs">
                  {person.knownForDepartment}
                </span>
              ) : null}
            </div>
            <h1 className="line-clamp-3 font-semibold text-2xl leading-tight sm:text-4xl">{person.name}</h1>
          </div>
        </div>

        {facts.length > 0 ? (
          <dl className="grid gap-2 px-4 pb-4 sm:grid-cols-3 sm:px-5 sm:pb-5">
            {facts.map((fact) => (
              <div key={fact.label} className="min-w-0 rounded-xl bg-white/10 p-3">
                <dt className="font-medium text-white/54 text-xs">{fact.label}</dt>
                <dd className="mt-1 line-clamp-2 font-medium text-sm text-white/90">{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        <div className="border-white/10 border-t px-4 py-4 sm:px-5">
          <p
            className={`${bioExpanded ? '' : 'line-clamp-4'} text-white/76 text-sm leading-6 sm:text-base sm:leading-7`}
          >
            {bioText}
          </p>
          {canToggleBio ? (
            <button
              type="button"
              onClick={() => setBioExpanded((value) => !value)}
              className="mt-3 font-medium text-[#c4b5fd] text-sm transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c4b5fd]"
            >
              {bioExpanded ? t('showLess') : t('showMore')}
            </button>
          ) : null}
        </div>
      </section>

      <section className="relative mb-6 hidden overflow-hidden rounded-[28px] bg-[#130d1f] text-white shadow-[0_28px_80px_rgba(33,22,47,0.28)] ring-1 ring-white/10 lg:block">
        {person.portraitUrl ? (
          <img
            src={person.portraitUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-18 blur-2xl"
          />
        ) : null}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(139,92,246,.34),transparent_34%),linear-gradient(120deg,#130d1f_0%,rgba(19,13,31,.94)_48%,rgba(19,13,31,.72)_100%)]" />

        <div className="relative grid gap-0 lg:grid-cols-[minmax(220px,320px)_minmax(0,1fr)]">
          <div className="relative min-h-[520px] overflow-hidden">
            {person.portraitUrl ? (
              <img src={person.portraitUrl} alt={person.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-white/8 text-white/50 text-sm">
                {t('noPortrait')}
              </div>
            )}
            <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(19,13,31,.08)_62%,#130d1f_100%)]" />
          </div>

          <div className="relative flex min-w-0 flex-col justify-end p-10">
            <div className="max-w-4xl">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white/12 px-3 py-1 font-medium text-white/72 text-xs backdrop-blur">
                  {t('personCreditsSubtitle', { count: results.length })}
                </span>
                {person.knownForDepartment ? (
                  <span className="rounded-full bg-[#8b5cf6]/28 px-3 py-1 font-medium text-white text-xs">
                    {person.knownForDepartment}
                  </span>
                ) : null}
              </div>
              <h1 className="text-balance font-semibold text-6xl leading-none">{person.name}</h1>
              {facts.length > 0 ? (
                <dl className="mt-5 grid gap-2 sm:grid-cols-3">
                  {facts.map((fact) => (
                    <div key={fact.label} className="min-w-0 rounded-xl bg-white/10 p-3 backdrop-blur">
                      <dt className="font-medium text-white/54 text-xs">{fact.label}</dt>
                      <dd className="mt-1 line-clamp-2 font-medium text-sm text-white/90">{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              <p className="mt-5 line-clamp-6 max-w-3xl text-base text-white/76 leading-7">{bioText}</p>
            </div>
          </div>
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

function getBackTo(state: unknown): string | undefined {
  if (!state || typeof state !== 'object' || !('from' in state)) return undefined
  const from = (state as { from?: unknown }).from
  return typeof from === 'string' ? from : undefined
}
