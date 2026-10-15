import { parseMediaKey } from '@shared/media-key'
import type { BookDetails, BookDiscoveryInput, BookSearchItem } from '@shared/types'
import { readChartEntries } from './charts'
import { ApiError, apiRequest, apiResourcePage, query } from './client'

export async function searchBooks(input: { query: string; page: number; pageSize?: number }) {
  return apiResourcePage<BookSearchItem>(
    `/api/catalog/books${query({ q: input.query, page: input.page, pageSize: input.pageSize })}`,
    'Failed to search books.',
  )
}

export async function discoverBooks(input: BookDiscoveryInput) {
  if (input.mode === 'trending') {
    const periods = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }
    return readChartEntries<BookSearchItem>('books-trending', {
      period: periods[input.period],
      page: input.page,
      pageSize: input.pageSize,
    })
  }
  return apiResourcePage<BookSearchItem>(
    `/api/catalog/books${query({
      subject: input.subject,
      page: input.page,
      pageSize: input.pageSize,
    })}`,
    'Failed to load books.',
  )
}

export async function getBookDetails(mediaKey: string) {
  const key = parseMediaKey(mediaKey)
  if (key?.provider === 'isbn') {
    const response = await apiRequest<{ items: BookDetails[] }>(
      `/api/catalog/book-editions${query({ isbn: key.id })}`,
      'Failed to locate book edition.',
    )
    if (!response.items[0]) throw new ApiError('Book edition not found.', 404)
    return response.items[0]
  }
  return apiRequest<BookDetails>(
    `/api/catalog/${key?.resourceType === 'edition' ? 'book-editions' : 'books'}/${encodeURIComponent(mediaKey)}`,
    'Failed to load book details.',
  )
}
