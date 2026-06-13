import type { DownloaderDetails, DownloaderHealth, DownloaderInput, DownloaderSummary } from '@shared/types'
import { apiRequest, jsonBody } from './client'

export async function listDownloaders() {
  return apiRequest<{ items: DownloaderSummary[] }>('/api/downloaders', 'Failed to load downloaders.')
}

export async function createDownloader(input: DownloaderInput) {
  return apiRequest<{ item: DownloaderSummary }>('/api/downloaders', 'Failed to create downloader.', jsonBody(input))
}

export async function getDownloader(id: string) {
  return apiRequest<{ item: DownloaderDetails }>(`/api/downloaders/${id}`, 'Failed to load downloader.')
}

export async function updateDownloader(id: string, input: DownloaderInput) {
  return apiRequest<{ item: DownloaderSummary }>(`/api/downloaders/${id}`, 'Failed to update downloader.', {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export async function deleteDownloader(id: string) {
  return apiRequest<{ id: string }>(`/api/downloaders/${id}`, 'Failed to delete downloader.', { method: 'DELETE' })
}

export async function checkDownloaderHealth(id: string) {
  return apiRequest<{ health: DownloaderHealth }>(
    `/api/downloaders/${id}/health`,
    'Failed to check downloader health.',
    { method: 'POST' },
  )
}
