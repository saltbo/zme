import { Bell, CheckCircle2, CircleAlert, LoaderCircle, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { type ReleaseSearchTask, useReleaseSearchTasks } from '@/contexts/release-search-tasks'
import { cn } from '@/lib/utils'

export function ReleaseSearchTasksButton() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { tasks, unreadCount, activeCount, markTaskRead, markAllRead } = useReleaseSearchTasks()
  const [open, setOpen] = useState(false)

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) markAllRead()
  }

  function openTask(task: ReleaseSearchTask) {
    if (task.status === 'searching') return
    markTaskRead(task.id)
    setOpen(false)
    navigate(task.request.resultPath, {
      state: task.request.originPath ? { origin: task.request.originPath } : undefined,
    })
  }

  const label =
    unreadCount > 0
      ? t('releaseSearchTasksUnread', { count: unreadCount })
      : activeCount > 0
        ? t('releaseSearchTasksActive', { count: activeCount })
        : t('releaseSearchTasks')

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <Button
        type="button"
        variant={unreadCount > 0 ? 'default' : 'outline'}
        size="icon-lg"
        className={cn(
          'relative size-11 rounded-full',
          unreadCount > 0 && 'shadow-md shadow-primary/25 ring-2 ring-primary/20',
        )}
        onClick={() => handleOpenChange(true)}
        aria-label={label}
        title={label}
      >
        {activeCount > 0 ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Bell />}
        {unreadCount > 0 ? (
          <span className="-top-1 -right-1 absolute flex min-w-5 items-center justify-center rounded-full bg-destructive px-1 font-semibold text-[10px] text-destructive-foreground leading-5 ring-2 ring-background">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </Button>

      <SheetContent
        side="right"
        className="w-full gap-0 overflow-hidden bg-background p-0 sm:max-w-md"
        aria-describedby="release-search-tasks-description"
      >
        <SheetHeader className="border-b px-5 py-5 pr-14">
          <SheetTitle className="text-lg">{t('releaseSearchTasks')}</SheetTitle>
          <SheetDescription id="release-search-tasks-description" className="sr-only">
            {t('releaseSearchTasksDescription')}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">
          {tasks.length > 0 ? (
            <div className="grid gap-3">
              {tasks.map((task) => (
                <ReleaseSearchTaskItem key={task.id} task={task} onOpen={() => openTask(task)} />
              ))}
            </div>
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Search className="size-5" />
              </span>
              <div className="mt-4 font-medium">{t('noReleaseSearchTasks')}</div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function ReleaseSearchTaskItem({ task, onOpen }: { task: ReleaseSearchTask; onOpen: () => void }) {
  const { i18n, t } = useTranslation()
  const status = getTaskStatus(task, t)
  const StatusIcon = status.icon
  const completed = task.status !== 'searching'
  const progress = task.progress

  return (
    <article
      className={cn(
        'relative overflow-hidden rounded-2xl border bg-card p-3.5',
        task.unread && 'border-primary/35 bg-primary/[0.035]',
      )}
    >
      {task.unread ? (
        <span className="absolute top-3 right-3 size-2 rounded-full bg-primary" aria-hidden="true" />
      ) : null}
      <div className="flex min-w-0 gap-3">
        <div className="h-16 w-11 shrink-0 overflow-hidden rounded-lg bg-muted">
          {task.request.media.posterUrl ? (
            <img src={task.request.media.posterUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Search className="size-4" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 pr-2">
          <h3 className="truncate font-medium text-sm">{task.request.media.title}</h3>
          <p className="mt-0.5 truncate text-muted-foreground text-xs">{task.request.displayQuery}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={cn('gap-1.5', status.className)}>
              <StatusIcon
                className={cn('size-3', task.status === 'searching' && 'animate-spin motion-reduce:animate-none')}
              />
              {status.label}
            </Badge>
            {task.items.length > 0 ? (
              <span className="text-muted-foreground text-xs">
                {t('releaseSearchTaskResultCount', { count: task.items.length })}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {task.status === 'searching' && progress ? (
        <div className="mt-3">
          <div className="mb-1.5 text-right text-muted-foreground text-xs">
            {progress.completed} / {progress.total}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${Math.max(8, (progress.completed / progress.total) * 100)}%` }}
            />
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-3">
        <time className="text-muted-foreground text-xs" dateTime={new Date(task.startedAt).toISOString()}>
          {new Date(task.startedAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}
        </time>
        {completed ? (
          <Button type="button" variant="secondary" size="sm" className="min-h-11" onClick={onOpen}>
            {task.status === 'failed' ? t('viewDetails') : t('viewResults')}
          </Button>
        ) : null}
      </div>
    </article>
  )
}

function getTaskStatus(task: ReleaseSearchTask, t: (key: string) => string) {
  if (task.status === 'completed') {
    return {
      icon: CheckCircle2,
      label: t('releaseSearchTaskCompleted'),
      className: 'border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300',
    }
  }
  if (task.status === 'failed') {
    return {
      icon: CircleAlert,
      label: t('releaseSearchTaskFailedStatus'),
      className: 'border-destructive/25 bg-destructive/8 text-destructive',
    }
  }
  return {
    icon: LoaderCircle,
    label: t('releaseSearchTaskSearching'),
    className: 'border-primary/25 bg-primary/8 text-primary',
  }
}
