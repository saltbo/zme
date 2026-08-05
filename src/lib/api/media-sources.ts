import type { MediaSourceDetails, MediaSourceHealth, MediaSourceInput, MediaSourceSummary } from '@shared/types'
import { apiRequest, jsonBody, mergePatch } from './client'

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

export async function updateMediaSource(id: string, input: MediaSourceInput, expectedUpdatedAt: string) {
  return apiRequest<{ item: MediaSourceSummary }>(`/api/media-sources/${id}`, 'Failed to update media source.', {
    ...mergePatch(input),
    headers: { ...mergePatch(input).headers, 'If-Match': `"${expectedUpdatedAt}"` },
  })
}

export async function deleteMediaSource(id: string, expectedUpdatedAt: string) {
  return apiRequest<void>(`/api/media-sources/${id}`, 'Failed to delete media source.', {
    method: 'DELETE',
    headers: { 'If-Match': `"${expectedUpdatedAt}"` },
  })
}

export async function checkMediaSourceHealth(id: string) {
  return apiRequest<{ item: MediaSourceHealth }>(
    `/api/media-sources/${id}/health-observations`,
    'Failed to check media source health.',
    { method: 'POST' },
  )
}
