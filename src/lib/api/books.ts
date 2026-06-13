import type { BookDetails, BookDiscoveryInput, BookSearchItem, ResourcePage } from '@shared/types'
import { apiRequest, query } from './client'

export async function searchBooks(input: { query: string; page: number; pageSize?: number }) {
  return apiRequest<ResourcePage<BookSearchItem>>(
    `/api/books/search${query({ q: input.query, page: input.page, pageSize: input.pageSize })}`,
    'Failed to search books.',
  )
}

export async function discoverBooks(input: BookDiscoveryInput) {
  return apiRequest<ResourcePage<BookSearchItem>>(
    `/api/books/discover${query({
      mode: input.mode,
      period: input.period,
      subject: input.subject,
      page: input.page,
      pageSize: input.pageSize,
    })}`,
    'Failed to load books.',
  )
}

export async function getBookDetails(mediaKey: string) {
  return apiRequest<{ item: BookDetails }>(`/api/books/${encodeURIComponent(mediaKey)}`, 'Failed to load book details.')
}
