import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import '@/i18n'
import { DownloadersPanel } from './downloaders'

vi.mock('@/hooks/use-downloader-queries', () => ({
  useDownloaders: () => ({ data: [], error: null, isLoading: false }),
}))

describe('DownloadersPanel', () => {
  it('opens the ZPan form with the current drive API endpoint', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <DownloadersPanel />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add downloader' }))

    expect(screen.getByDisplayValue('https://drive.zpan.space')).toBeInTheDocument()
  })
})
