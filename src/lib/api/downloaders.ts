import type {
  ConnectionPatch,
  DownloaderDetails,
  DownloaderHealth,
  DownloaderInput,
  DownloaderSummary,
} from '@shared/types'
import { apiRequest, jsonBody, mergePatch } from './client'

export async function listDownloaders() {
  return apiRequest<{ items: DownloaderSummary[] }>('/api/downloaders', 'Failed to load downloaders.')
}

export async function createDownloader(input: DownloaderInput) {
  return apiRequest<DownloaderSummary>('/api/downloaders', 'Failed to create downloader.', jsonBody(input))
}

export async function getDownloader(id: string) {
  return apiRequest<DownloaderDetails>(`/api/downloaders/${id}`, 'Failed to load downloader.')
}

export async function updateDownloader(id: string, input: ConnectionPatch<DownloaderInput>) {
  return apiRequest<DownloaderSummary>(`/api/downloaders/${id}`, 'Failed to update downloader.', {
    ...mergePatch(input),
  })
}

export async function deleteDownloader(id: string) {
  return apiRequest<void>(`/api/downloaders/${id}`, 'Failed to delete downloader.', {
    method: 'DELETE',
  })
}

export async function checkDownloaderHealth(id: string) {
  return apiRequest<DownloaderHealth>(`/api/downloaders/${id}/health`, 'Failed to check downloader health.', {
    method: 'GET',
    cache: 'no-store',
  })
}
