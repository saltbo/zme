import type { LibraryStateItem } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { server } from '@/test/msw'
import { LibraryProvider, useLibrary } from './library'

// useTranslation/toast are UI chrome; the logic under test is the react-query
// cache reconciliation, exercised through the real api client + a stateful MSW
// backend (the context invalidates and refetches after each mutation).
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function libraryItem(id: number, savedAt: string | null, watchedAt: string | null): LibraryStateItem {
  return { mediaKey: `tmdb:movie:${id}`, id, kind: 'movie', savedAt, watchedAt, updatedAt: '2026-06-01T00:00:00.000Z' }
}

// A minimal in-memory library backend so GET reflects prior PUT/DELETE.
function mockLibraryBackend(initial: LibraryStateItem[] = []) {
  const store = new Map(initial.map((item) => [item.mediaKey, item]))
  const now = '2026-06-01T00:00:00.000Z'
  server.use(
    http.get('/api/library/states', () => HttpResponse.json({ items: [...store.values()] })),
    http.put('/api/library/resources', async ({ request }) => {
      const body = (await request.json()) as { mediaKey: string; kind: 'movie'; status: 'saved' | 'watched' }
      const existing = store.get(body.mediaKey)
      const item = libraryItem(
        Number(body.mediaKey.split(':')[2]),
        existing?.savedAt ?? now,
        body.status === 'watched' ? now : (existing?.watchedAt ?? null),
      )
      store.set(body.mediaKey, item)
      return HttpResponse.json({ item })
    }),
    http.delete('/api/library/resources/:mediaKey', ({ params }) => {
      const mediaKey = decodeURIComponent(params.mediaKey as string)
      store.delete(mediaKey)
      return HttpResponse.json({ mediaKey, kind: 'movie' })
    }),
  )
  return store
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{<LibraryProvider>{children}</LibraryProvider>}</QueryClientProvider>
}

async function renderLibrary() {
  const view = renderHook(() => useLibrary(), { wrapper })
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  return view
}

const movie = { id: 550, kind: 'movie' as const } as never

describe('LibraryProvider', () => {
  it('reflects loaded states [spec: library/list-states]', async () => {
    mockLibraryBackend([libraryItem(550, '2026-05-01T00:00:00.000Z', null)])

    const { result } = await renderLibrary()

    expect(result.current.isSaved(movie)).toBe(true)
    expect(result.current.isWatched(movie)).toBe(false)
    expect(result.current.getMediaStatus(movie)).toBe('saved')
  })

  it('saving an unsaved item updates the cache to saved [spec: library/save-resource]', async () => {
    mockLibraryBackend()

    const { result } = await renderLibrary()
    expect(result.current.isSaved(movie)).toBe(false)

    await result.current.toggleSaved(movie)

    await waitFor(() => expect(result.current.isSaved(movie)).toBe(true))
    expect(result.current.getMediaStatus(movie)).toBe('saved')
  })

  it('marking watched reflects the watched status [spec: library/watch-resource]', async () => {
    mockLibraryBackend()

    const { result } = await renderLibrary()
    await result.current.setMediaStatus(movie, 'watched')

    await waitFor(() => expect(result.current.getMediaStatus(movie)).toBe('watched'))
    expect(result.current.isWatched(movie)).toBe(true)
  })

  it('removing a saved item drops it from the cache [spec: library/remove-resource]', async () => {
    mockLibraryBackend([libraryItem(550, '2026-05-01T00:00:00.000Z', null)])

    const { result } = await renderLibrary()
    expect(result.current.isSaved(movie)).toBe(true)

    await result.current.toggleSaved(movie)

    await waitFor(() => expect(result.current.isSaved(movie)).toBe(false))
    expect(result.current.getMediaStatus(movie)).toBe('none')
  })
})
