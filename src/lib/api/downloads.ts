import type { CreateDownloadInput, CreateDownloadResult, DownloadTaskPage } from '@shared/types'
import { apiRequest, jsonBody, query } from './client'

export async function listDownloadTasks(input: { status?: string; page: number; pageSize: number }) {
  return apiRequest<DownloadTaskPage>(
    `/api/downloads${query({ status: input.status, page: input.page, pageSize: input.pageSize })}`,
    'Failed to load downloads.',
  )
}

export function downloadTaskEventsUrl() {
  return '/api/downloads/events'
}

export async function createDownload(input: CreateDownloadInput) {
  return apiRequest<{ item: CreateDownloadResult }>('/api/downloads', 'Failed to submit download.', jsonBody(input))
}
