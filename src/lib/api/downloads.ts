import type { CreateDownloadInput, CreateDownloadResult, DownloadTaskPage } from '@shared/types'
import { apiRequest, jsonBody, query } from './client'

export async function listDownloadTasks(input: { status?: string; page: number; pageSize: number }) {
  return apiRequest<DownloadTaskPage>(
    `/api/downloads${query({ status: input.status, page: input.page, pageSize: input.pageSize })}`,
    'Failed to load downloads.',
  )
}

export function downloadTaskEventsUrl() {
  return '/api/downloads/events?apiVersion=2026-08-04'
}

export async function createDownload(input: CreateDownloadInput) {
  const init = jsonBody(input)
  init.headers = { 'Idempotency-Key': crypto.randomUUID() }
  return apiRequest<{ item: CreateDownloadResult }>('/api/downloads', 'Failed to submit download.', init)
}
