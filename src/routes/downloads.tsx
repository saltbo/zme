import type { DownloadTaskStatus, DownloadTaskSummary, MediaKind } from '@shared/types'
import { AlertTriangle, CheckCircle2, Clock, DownloadCloud, Gauge, LoaderCircle, Server } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { useDownloadTasks } from '@/hooks/use-download-task-queries'
import { useMediaDetails } from '@/hooks/use-media-queries'
import { getTmdbLanguage } from '@/i18n'
import { cn, formatBytes } from '@/lib/utils'

const activeStatuses = new Set<DownloadTaskStatus>(['queued', 'assigned', 'running', 'billing_paused', 'uploading'])
const statusFilters: DownloadTaskStatus[] = [
  'queued',
  'assigned',
  'running',
  'billing_paused',
  'uploading',
  'completed',
  'failed',
  'canceled',
]
const skeletonKeys = ['download-skeleton-1', 'download-skeleton-2', 'download-skeleton-3', 'download-skeleton-4']
type StatusFilter = 'all' | DownloadTaskStatus

export function DownloadsPage() {
  const { t } = useTranslation()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const downloads = useDownloadTasks(statusFilter)
  const tasks = downloads.data?.pages.flatMap((page) => page.items) ?? []
  const total = downloads.data?.pages[0]?.total ?? 0
  const active = tasks.filter((task) => activeStatuses.has(task.status)).length
  const totalSpeed = tasks.reduce((sum, task) => sum + task.downloadBps, 0)

  useEffect(() => {
    const node = loadMoreRef.current
    if (!node) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && downloads.hasNextPage && !downloads.isFetchingNextPage) {
        void downloads.fetchNextPage()
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [downloads])

  return (
    <main className="mx-auto flex w-full max-w-[1680px] flex-col gap-5 p-4 sm:p-6 lg:p-8">
      <section className="grid gap-3 sm:grid-cols-3">
        <SummaryTile label={t('activeDownloads')} value={String(active)} icon={DownloadCloud} />
        <SummaryTile label={t('downloadSpeed')} value={`${formatRate(totalSpeed)}/s`} icon={Gauge} />
        <SummaryTile label={t('downloadTaskCount')} value={String(total)} icon={Server} />
      </section>

      <StatusFilterBar value={statusFilter} onChange={setStatusFilter} />

      {downloads.error ? (
        <Card className="border-destructive/30 bg-destructive/5 p-5 text-destructive">
          {downloads.error instanceof Error ? downloads.error.message : t('downloadsLoadFailed')}
        </Card>
      ) : null}

      {downloads.isLoading ? <DownloadsSkeleton /> : null}
      {!downloads.isLoading && tasks.length === 0 ? (
        statusFilter === 'all' ? (
          <EmptyDownloads />
        ) : (
          <EmptyFilteredDownloads />
        )
      ) : null}
      {!downloads.isLoading && tasks.length > 0 ? (
        <section className="grid gap-4 xl:grid-cols-2">
          {tasks.map((task) => (
            <DownloadTaskCard key={`${task.downloaderId}:${task.id}`} task={task} />
          ))}
        </section>
      ) : null}
      <div ref={loadMoreRef} className="min-h-1" />
      {downloads.isFetchingNextPage ? <DownloadsSkeleton compact /> : null}
    </main>
  )
}

function StatusFilterBar({ value, onChange }: { value: StatusFilter; onChange: (value: StatusFilter) => void }) {
  const { t } = useTranslation()
  const filters: StatusFilter[] = ['all', ...statusFilters]

  return (
    <div className="zme-x-scroll -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      {filters.map((status) => {
        const active = value === status
        return (
          <Button
            key={status}
            type="button"
            variant={active ? 'default' : 'outline'}
            size="sm"
            className="h-8 shrink-0 rounded-full px-3"
            onClick={() => onChange(status)}
          >
            {status === 'all' ? t('downloadFilterAll') : getStatusLabel(status, t)}
          </Button>
        )
      })}
    </div>
  )
}

function SummaryTile({ icon: Icon, label, value }: { icon: typeof DownloadCloud; label: string; value: string }) {
  return (
    <Card className="rounded-lg p-4">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="text-muted-foreground text-sm">{label}</div>
          <div className="truncate font-semibold text-xl">{value}</div>
        </div>
      </div>
    </Card>
  )
}

function DownloadTaskCard({ task }: { task: DownloadTaskSummary }) {
  const { t, i18n } = useTranslation()
  const taggedMedia = getTaggedMedia(task)
  const language = getTmdbLanguage(i18n.language)
  const mediaDetails = useMediaDetails(taggedMedia?.kind ?? 'movie', taggedMedia?.tmdbId ?? 0, language)
  const posterMedia = mediaDetails.data ?? null
  const imageUrl = posterMedia?.backdropUrl ?? posterMedia?.posterUrl
  const progress = getProgress(task)
  const status = getStatusMeta(task.status, t)

  return (
    <article className="group">
      <div className="relative min-h-44 overflow-hidden rounded-xl bg-card shadow-[0_18px_38px_rgba(33,22,47,0.14)] ring-1 ring-foreground/10 transition duration-300 group-hover:-translate-y-0.5 group-hover:shadow-[0_24px_48px_rgba(33,22,47,0.2)] sm:aspect-[16/7] sm:min-h-0">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`${posterMedia?.title ?? task.name} poster`}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-[linear-gradient(155deg,#26231f_0%,#595245_52%,#171615_100%)] text-white">
            <DownloadCloud className="size-14 text-white/36" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/64 to-black/8" />
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <Badge
            className={cn(
              'h-7 gap-1 rounded-full border-white/16 bg-black/42 text-white backdrop-blur',
              status.className,
            )}
          >
            <status.icon className="size-3.5" />
            {status.label}
          </Badge>
          <Badge className="h-7 rounded-full border-white/16 bg-black/42 text-white backdrop-blur">
            {progress.label}
          </Badge>
        </div>
        <div className="absolute inset-x-0 bottom-0 max-w-2xl p-4 text-white sm:p-5">
          <h2 className="line-clamp-2 text-balance font-semibold text-xl leading-tight drop-shadow">
            {getDisplayTitle(task.name)}
          </h2>
          <div className="mt-2 flex items-center justify-between gap-3 text-white/82 text-xs">
            <span className="line-clamp-1">{task.downloaderName}</span>
            <span className="shrink-0 font-medium">{formatRate(task.downloadBps)}/s</span>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/18">
          <div className="h-full bg-white" style={{ width: `${progress.value}%` }} />
        </div>
      </div>
    </article>
  )
}

function getTaggedMedia(task: DownloadTaskSummary): { kind: MediaKind; tmdbId: number } | null {
  const kind = task.category === 'movie' || task.category === 'tv' ? task.category : null
  const tmdbId = getTagNumber(task.tags, 'tmdbId')
  return kind && tmdbId ? { kind, tmdbId } : null
}

function getTagNumber(tags: string[], key: string): number | null {
  const prefix = `${key}=`
  const tag = tags.find((value) => value.startsWith(prefix))
  if (!tag) return null
  const value = Number(tag.slice(prefix.length))
  return Number.isInteger(value) && value > 0 ? value : null
}

function getStatusMeta(status: DownloadTaskStatus, t: (key: string) => string) {
  if (status === 'completed') {
    return { label: getStatusLabel(status, t), icon: CheckCircle2, className: 'text-emerald-100' }
  }
  if (status === 'failed' || status === 'canceled') {
    return {
      label: getStatusLabel(status, t),
      icon: AlertTriangle,
      className: 'text-red-100',
    }
  }
  if (status === 'queued' || status === 'assigned') {
    return { label: getStatusLabel(status, t), icon: Clock, className: 'text-amber-100' }
  }
  return { label: getStatusLabel(status, t), icon: LoaderCircle, className: 'text-white' }
}

function getStatusLabel(status: DownloadTaskStatus, t: (key: string) => string) {
  return status === 'completed' ? t('downloadStatusCompleted') : t(`downloadStatus_${status}`)
}

function getProgress(task: DownloadTaskSummary) {
  if (!task.totalBytes || task.totalBytes <= 0) return { value: 0, label: '0%' }
  const value = Math.min(100, Math.max(0, (task.downloadedBytes / task.totalBytes) * 100))
  return { value, label: `${value.toFixed(value >= 10 ? 0 : 1)}%` }
}

function formatRate(value: number) {
  if (value <= 0) return '0 B'
  return formatBytes(value).replace('Unknown size', '0 B')
}

function getDisplayTitle(name: string) {
  return name
    .replace(/\.torrent$/i, '')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\((19|20)\d{2}\)/g, ' $1 ')
    .replace(/[._+]+/g, ' ')
    .replace(/\s+-\s+.+$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function DownloadsSkeleton({ compact }: { compact?: boolean }) {
  return (
    <section className="grid gap-4 xl:grid-cols-2">
      {skeletonKeys.slice(0, compact ? 2 : skeletonKeys.length).map((key) => (
        <Skeleton key={key} className="h-64 rounded-lg" />
      ))}
    </section>
  )
}

function EmptyDownloads() {
  const { t } = useTranslation()
  return (
    <Empty className="min-h-[360px] border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <DownloadCloud />
        </EmptyMedia>
        <EmptyTitle>{t('noDownloads')}</EmptyTitle>
        <EmptyDescription>{t('noDownloadsDescription')}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function EmptyFilteredDownloads() {
  const { t } = useTranslation()
  return (
    <Empty className="min-h-[280px] border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <DownloadCloud />
        </EmptyMedia>
        <EmptyTitle>{t('noFilteredDownloads')}</EmptyTitle>
        <EmptyDescription>{t('noFilteredDownloadsDescription')}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
