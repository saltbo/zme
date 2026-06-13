import type { MediaSourceDetails, MediaSourceHealth, MediaSourceInput, MediaSourceSummary } from '@shared/types'
import { apiRequest, jsonBody } from './client'

export async function listMediaSources() {
  return apiRequest<{ items: MediaSourceSummary[] }>('/api/media-sources', 'Failed to load media sources.')
}

export async function createMediaSource(input: MediaSourceInput) {
  return apiRequest<{ item: MediaSourceSummary }>(
    '/api/media-sources',
    'Failed to create media source.',
    jsonBody(input),
  )
}

export async function getMediaSource(id: string) {
  return apiRequest<{ item: MediaSourceDetails }>(`/api/media-sources/${id}`, 'Failed to load media source.')
}

export async function updateMediaSource(id: string, input: MediaSourceInput) {
  return apiRequest<{ item: MediaSourceSummary }>(`/api/media-sources/${id}`, 'Failed to update media source.', {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export async function deleteMediaSource(id: string) {
  return apiRequest<{ id: string }>(`/api/media-sources/${id}`, 'Failed to delete media source.', {
    method: 'DELETE',
  })
}

export async function checkMediaSourceHealth(id: string) {
  return apiRequest<{ health: MediaSourceHealth }>(
    `/api/media-sources/${id}/health`,
    'Failed to check media source health.',
    { method: 'POST' },
  )
}
