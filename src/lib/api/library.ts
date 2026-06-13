import type {
  LibraryMediaPage,
  LibraryPageInput,
  LibraryResourceInput,
  LibraryResourceStateInput,
  LibrarySourceInput,
  LibrarySourceKind,
  LibrarySourceSummary,
  LibrarySourceSyncResult,
  LibraryStateItem,
} from '@shared/types'
import { apiRequest, query } from './client'

export async function listLibrary(input: LibraryPageInput) {
  return apiRequest<LibraryMediaPage>(
    `/api/library${query({
      page: input.page,
      pageSize: input.pageSize,
      language: input.language,
      kind: input.kind && input.kind !== 'all' ? input.kind : undefined,
      status: input.status && input.status !== 'all' ? input.status : undefined,
    })}`,
    'Failed to load library.',
  )
}

export async function listLibraryStates() {
  return apiRequest<{ items: LibraryStateItem[] }>('/api/library/states', 'Failed to load library states.')
}

export async function saveLibraryResource(input: LibraryResourceStateInput) {
  return apiRequest<{ item: LibraryStateItem }>('/api/library/resources', 'Failed to save library item.', {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export async function removeLibraryResource(input: LibraryResourceInput) {
  return apiRequest<{ mediaKey: string; kind: LibraryResourceInput['kind'] }>(
    `/api/library/resources/${encodeURIComponent(input.mediaKey)}`,
    'Failed to remove library item.',
    {
      method: 'DELETE',
      body: JSON.stringify(input),
    },
  )
}

export async function listLibrarySources() {
  return apiRequest<{ items: LibrarySourceSummary[] }>('/api/library/sources', 'Failed to load library sources.')
}

export async function saveLibrarySource(source: LibrarySourceKind, input: LibrarySourceInput) {
  return apiRequest<{ item: LibrarySourceSummary }>(
    `/api/library/sources/${source}`,
    'Failed to save library source.',
    {
      method: 'PUT',
      body: JSON.stringify(input),
    },
  )
}

export async function deleteLibrarySource(source: LibrarySourceKind) {
  return apiRequest<{ source: LibrarySourceKind }>(
    `/api/library/sources/${source}`,
    'Failed to delete library source.',
    {
      method: 'DELETE',
    },
  )
}

export async function syncLibrarySource(source: LibrarySourceKind) {
  return apiRequest<{ result: LibrarySourceSyncResult }>(
    `/api/library/sources/${source}/sync`,
    'Failed to sync library source.',
    { method: 'POST' },
  )
}
