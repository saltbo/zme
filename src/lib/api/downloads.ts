import type { DownloadPage } from '@shared/types'
import { apiRequest, jsonBody, query } from './client'

export async function listDownloadTasks(input: {
  status?: string
  page: number
  pageSize: number
}): Promise<DownloadPage> {
  const result = await apiRequest<{
    items: Array<
      Omit<
        DownloadPage['items'][number],
        'downloadedBytes' | 'storageUploadedBytes' | 'totalBytes' | 'downloadBps' | 'storageUploadBps' | 'errorMessage'
      > & {
        progress: Pick<
          DownloadPage['items'][number],
          'downloadedBytes' | 'storageUploadedBytes' | 'totalBytes' | 'downloadBps' | 'storageUploadBps'
        >
        result: { objectId: string | null } | null
        error: string | null
      }
    >
    pagination: { page: number; pageSize: number; totalItems: number }
  }>(
    `/api/downloads${query({ status: input.status, page: input.page, pageSize: input.pageSize })}`,
    'Failed to load downloads.',
  )
  return {
    items: result.items.map((item) => {
      const { progress, result, error, ...download } = item
      return {
        ...download,
        ...progress,
        errorMessage: error,
        outputObjectId: result?.objectId ?? null,
      }
    }),
    page: result.pagination.page,
    pageSize: result.pagination.pageSize,
    total: result.pagination.totalItems,
  }
}

export async function createDownload(input: { resourceRef: string; downloaderId: string }) {
  const init = jsonBody(input)
  init.headers = { 'Idempotency-Key': crypto.randomUUID() }
  return apiRequest('/api/downloads', 'Failed to submit download.', init)
}
