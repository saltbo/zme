import type { ReleaseCandidateFull } from '@shared/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReleaseSearchTasksProvider, useReleaseSearchTasks } from '@/contexts/release-search-tasks'
import '@/i18n'
import { searchMediaReleasesInSteps } from '@/lib/release-search'
import type { ReleaseSearchTaskRequest } from '@/lib/release-search-context'

const toastMocks = vi.hoisted(() => ({
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/lib/release-search', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/release-search')>()
  return {
    ...original,
    searchMediaReleasesInSteps: vi.fn(),
  }
})

vi.mock('sonner', () => ({
  toast: toastMocks,
}))

const mockedSearchMediaReleases = vi.mocked(searchMediaReleasesInSteps)

describe('release search tasks', () => {
  beforeEach(() => {
    mockedSearchMediaReleases.mockReset()
    vi.clearAllMocks()
  })

  it('keeps a search running after the detail action leaves the tree', async () => {
    let finishSearch: ((value: { items: ReleaseCandidateFull[]; stoppedEarly: boolean }) => void) | undefined
    mockedSearchMediaReleases.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSearch = resolve
        }),
    )

    renderTaskHarness()

    fireEvent.click(screen.getByRole('button', { name: 'Start search' }))
    expect(screen.getByTestId('task-status')).toHaveTextContent('searching')

    fireEvent.click(screen.getByRole('button', { name: 'Leave detail' }))
    expect(screen.queryByRole('button', { name: 'Start search' })).not.toBeInTheDocument()
    expect(screen.getByTestId('task-status')).toHaveTextContent('searching')

    await act(async () => {
      finishSearch?.({ items: [release], stoppedEarly: true })
    })

    await waitFor(() => expect(screen.getByTestId('task-status')).toHaveTextContent('completed:1'))
    expect(screen.getByTestId('unread-count')).toHaveTextContent('1')
  })

  it('does not start a duplicate request while the same title is searching', () => {
    mockedSearchMediaReleases.mockImplementation(() => new Promise(() => {}))

    renderTaskHarness()

    fireEvent.click(screen.getByRole('button', { name: 'Start search' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start search' }))

    expect(mockedSearchMediaReleases).toHaveBeenCalledOnce()
  })

  it('routes task feedback to the offset search toaster', () => {
    mockedSearchMediaReleases.mockImplementation(() => new Promise(() => {}))

    renderTaskHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Start search' }))

    expect(toastMocks.info.mock.calls[0]?.[1]).toMatchObject({ toasterId: 'release-search' })
  })

  it('warns before reloading only while a search is running', async () => {
    let finishSearch: ((value: { items: ReleaseCandidateFull[]; stoppedEarly: boolean }) => void) | undefined
    mockedSearchMediaReleases.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSearch = resolve
        }),
    )

    renderTaskHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Start search' }))

    const runningEvent = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(runningEvent)
    expect(runningEvent.defaultPrevented).toBe(true)

    await act(async () => {
      finishSearch?.({ items: [release], stoppedEarly: false })
    })
    await waitFor(() => expect(screen.getByTestId('task-status')).toHaveTextContent('completed:1'))

    const completedEvent = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(completedEvent)
    expect(completedEvent.defaultPrevented).toBe(false)
  })
})

function renderTaskHarness() {
  return render(
    <MemoryRouter>
      <ReleaseSearchTasksProvider>
        <TaskHarness />
      </ReleaseSearchTasksProvider>
    </MemoryRouter>,
  )
}

function TaskHarness() {
  const [showDetail, setShowDetail] = useState(true)
  const { tasks, unreadCount, startTask } = useReleaseSearchTasks()
  const task = tasks[0]

  return (
    <>
      {showDetail ? (
        <>
          <button type="button" onClick={() => startTask(request)}>
            Start search
          </button>
          <button type="button" onClick={() => setShowDetail(false)}>
            Leave detail
          </button>
        </>
      ) : null}
      <div data-testid="task-status">{task ? `${task.status}:${task.items.length}` : 'idle'}</div>
      <div data-testid="unread-count">{unreadCount}</div>
    </>
  )
}

const request: ReleaseSearchTaskRequest = {
  mode: 'media',
  fingerprint: 'movie:603',
  displayQuery: 'Matrix 1999',
  resultPath: '/movies/603/releases',
  originPath: '/movies/603',
  media: {
    id: 603,
    kind: 'movie',
    title: 'The Matrix',
    originalTitle: 'Matrix',
    overview: '',
    posterUrl: null,
    backdropUrl: null,
    releaseYear: '1999',
    rating: 8.2,
    genres: ['Action'],
  },
  search: {
    query: 'Matrix 1999',
    title: 'Matrix',
    originalTitle: 'Matrix',
    localizedTitle: 'The Matrix',
    englishTitle: 'The Matrix',
    originalLanguage: 'en',
    aliases: [],
    year: '1999',
    kind: 'movie',
    tmdbId: 603,
  },
}

const release: ReleaseCandidateFull = {
  id: 'release-1',
  downloadTarget: null,
  title: 'The.Matrix.1999.1080p.BluRay',
  fileName: null,
  indexer: 'Test',
  size: 1_000,
  quality: {
    resolution: '1080p',
    source: 'bluray',
    codec: null,
    hdr: null,
    audio: null,
    tier: 'good',
    warnings: [],
  },
  availability: { tier: 'high' },
  seeders: 20,
  leechers: 2,
  files: 1,
  publishDate: '2026-07-27T00:00:00.000Z',
  resourceRef: 'release-ref:v1:test',
  resourceRefExpiresAt: '2026-08-08T00:00:00.000Z',
  sourceType: 'torrent_url',
  infoUrl: null,
  categories: ['Movies'],
  categoryIds: [2000],
  indexerFlags: [],
  imdbId: 133093,
  tmdbId: 603,
  tvdbId: null,
}
