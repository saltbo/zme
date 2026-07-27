import type { IndexerSearchItem } from '@shared/types'
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import type { ReleaseSearchError } from '@/components/release-search-dialog'
import { ApiError } from '@/lib/api'
import {
  type ReleaseSearchProgress,
  type ReleaseSearchProgressHandler,
  searchMediaReleasesInSteps,
  searchResourceReleasesInSteps,
} from '@/lib/release-search'
import type { ReleaseSearchTaskRequest } from '@/lib/release-search-context'

export type ReleaseSearchTaskStatus = 'searching' | 'completed' | 'failed'

export interface ReleaseSearchTask {
  id: string
  request: ReleaseSearchTaskRequest
  status: ReleaseSearchTaskStatus
  items: IndexerSearchItem[]
  progress: ReleaseSearchProgress | null
  canSearchMore: boolean
  error: ReleaseSearchError | null
  unread: boolean
  startedAt: number
  completedAt: number | null
}

interface StartReleaseSearchOptions {
  exhaustive?: boolean
  announce?: boolean
}

interface ReleaseSearchTasksValue {
  tasks: ReleaseSearchTask[]
  unreadCount: number
  activeCount: number
  startTask: (request: ReleaseSearchTaskRequest, options?: StartReleaseSearchOptions) => ReleaseSearchTask
  markTaskRead: (id: string) => void
  markAllRead: () => void
}

const ReleaseSearchTasksContext = createContext<ReleaseSearchTasksValue | null>(null)
const maximumRetainedTasks = 12
const releaseSearchToasterId = 'release-search'

export function ReleaseSearchTasksProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const tasksRef = useRef(new Map<string, ReleaseSearchTask>())
  const [, setRevision] = useState(0)

  const publish = useCallback(() => {
    setRevision((current) => current + 1)
  }, [])

  const openResults = useCallback(
    (task: ReleaseSearchTask) => {
      navigate(task.request.resultPath, {
        state: task.request.originPath ? { origin: task.request.originPath } : undefined,
      })
    },
    [navigate],
  )

  const startTask = useCallback(
    (request: ReleaseSearchTaskRequest, options: StartReleaseSearchOptions = {}) => {
      const existing = tasksRef.current.get(request.fingerprint)
      if (existing?.status === 'searching') {
        if (options.announce !== false) {
          toast.info(t('releaseSearchAlreadyRunning'), {
            description: request.media.title,
            toasterId: releaseSearchToasterId,
          })
        }
        return existing
      }

      const task: ReleaseSearchTask = {
        id: request.fingerprint,
        request,
        status: 'searching',
        items: [],
        progress: null,
        canSearchMore: false,
        error: null,
        unread: false,
        startedAt: Date.now(),
        completedAt: null,
      }
      tasksRef.current.set(task.id, task)
      pruneTasks(tasksRef.current, task.id)
      publish()

      if (options.announce !== false) {
        toast.info(t('releaseSearchStarted'), {
          description: t('releaseSearchStartedDescription', { title: request.media.title }),
          toasterId: releaseSearchToasterId,
        })
      }

      const onProgress: ReleaseSearchProgressHandler = (progress, results) => {
        task.progress = progress
        task.items = results
        publish()
      }

      void (
        request.mode === 'media'
          ? searchMediaReleasesInSteps(request.search, onProgress, { exhaustive: options.exhaustive })
          : searchResourceReleasesInSteps(request.search, onProgress)
      )
        .then((outcome) => {
          task.items = outcome.items
          task.canSearchMore = outcome.stoppedEarly
          task.status = 'completed'
          task.error = null
          task.unread = true
          task.completedAt = Date.now()
          toast.success(t('releaseSearchCompleted'), {
            description: t('releaseSearchCompletedDescription', {
              title: request.media.title,
              count: outcome.items.length,
            }),
            action: {
              label: t('viewResults'),
              onClick: () => openResults(task),
            },
            toasterId: releaseSearchToasterId,
          })
        })
        .catch((error) => {
          task.items = []
          task.canSearchMore = false
          task.status = 'failed'
          task.error = getReleaseSearchError(error, t)
          task.unread = true
          task.completedAt = Date.now()
          toast.error(t('releaseSearchTaskFailed'), {
            description: task.error.description,
            action: {
              label: t('viewDetails'),
              onClick: () => openResults(task),
            },
            toasterId: releaseSearchToasterId,
          })
        })
        .finally(() => {
          task.progress = null
          publish()
        })

      return task
    },
    [openResults, publish, t],
  )

  const markTaskRead = useCallback(
    (id: string) => {
      const task = tasksRef.current.get(id)
      if (!task?.unread) return
      task.unread = false
      publish()
    },
    [publish],
  )

  const markAllRead = useCallback(() => {
    let changed = false
    for (const task of tasksRef.current.values()) {
      if (!task.unread) continue
      task.unread = false
      changed = true
    }
    if (changed) publish()
  }, [publish])

  const tasks = [...tasksRef.current.values()].sort((left, right) => right.startedAt - left.startedAt)
  const activeCount = tasks.filter((task) => task.status === 'searching').length

  useEffect(() => {
    if (activeCount === 0) return

    const preventSearchInterruption = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', preventSearchInterruption)
    return () => window.removeEventListener('beforeunload', preventSearchInterruption)
  }, [activeCount])

  const value = useMemo<ReleaseSearchTasksValue>(
    () => ({
      tasks,
      unreadCount: tasks.filter((task) => task.unread).length,
      activeCount,
      startTask,
      markTaskRead,
      markAllRead,
    }),
    [activeCount, markAllRead, markTaskRead, startTask, tasks],
  )

  return <ReleaseSearchTasksContext.Provider value={value}>{children}</ReleaseSearchTasksContext.Provider>
}

export function useReleaseSearchTasks() {
  const context = useContext(ReleaseSearchTasksContext)
  if (!context) throw new Error('useReleaseSearchTasks must be used within ReleaseSearchTasksProvider.')
  return context
}

function pruneTasks(tasks: Map<string, ReleaseSearchTask>, activeTaskId: string) {
  if (tasks.size <= maximumRetainedTasks) return

  const removable = [...tasks.values()]
    .filter((task) => task.id !== activeTaskId && task.status !== 'searching')
    .sort((left, right) => left.startedAt - right.startedAt)

  while (tasks.size > maximumRetainedTasks && removable.length > 0) {
    const task = removable.shift()
    if (task) tasks.delete(task.id)
  }
}

function getReleaseSearchError(error: unknown, t: TFunction): ReleaseSearchError {
  if (error instanceof ApiError && (error.code === 'INDEXER_NOT_CONFIGURED' || error.status === 404)) {
    return {
      title: t('indexerNotConfiguredTitle'),
      description: t('indexerNotConfiguredDescription'),
      action: t('retrySearch'),
      tone: 'configuration',
    }
  }

  if (error instanceof ApiError && error.status === 502) {
    return {
      title: t('indexerConnectionFailedTitle'),
      description: t('indexerConnectionFailedDescription'),
      action: t('retrySearch'),
      tone: 'connection',
    }
  }

  return {
    title: t('indexerSearchFailedTitle'),
    description: error instanceof Error ? error.message : t('indexerSearchFailedDescription'),
    action: t('retrySearch'),
    tone: 'generic',
  }
}
