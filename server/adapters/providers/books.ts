import { type BookProvider, BookProviderError } from '@server/usecases/ports'
import { buildMediaKey, parseMediaKey } from '@shared/media-key'
import type {
  BookCover,
  BookDetails,
  BookDiscoveryInput,
  BookEditionCandidate,
  BookSearchItem,
  ResourcePage,
} from '@shared/types'

interface OpenLibrarySearchResponse {
  docs?: OpenLibrarySearchDoc[]
  numFound?: number
  start?: number
}

interface OpenLibraryTrendingResponse {
  works?: OpenLibrarySearchDoc[]
}

interface OpenLibrarySubjectResponse {
  works?: OpenLibrarySearchDoc[]
  work_count?: number
}

interface OpenLibrarySearchDoc {
  key?: string
  title?: string
  author_name?: string[]
  language?: string[]
  first_publish_year?: number
  cover_i?: number
  isbn?: string[]
  edition_key?: string[]
  alternative_title?: string[]
}

interface OpenLibraryWorkResponse {
  key?: string
  title?: string
  subtitle?: string
  other_titles?: string[]
  description?: string | { value?: string }
  authors?: Array<{ author?: { key?: string } }>
  covers?: number[]
  first_publish_date?: string
}

interface OpenLibraryEditionResponse {
  key?: string
  title?: string
  subtitle?: string
  other_titles?: string[]
  authors?: Array<{ key?: string }>
  works?: Array<{ key?: string }>
  isbn_10?: string[]
  isbn_13?: string[]
  languages?: Array<{ key?: string }>
  covers?: number[]
  publish_date?: string
}

interface OpenLibraryEditionsResponse {
  entries?: OpenLibraryEditionResponse[]
}

interface OpenLibraryAuthorResponse {
  name?: string
}

type BookMediaKey =
  | { provider: 'isbn'; resourceType: 'book'; id: string }
  | { provider: 'openlibrary'; resourceType: 'work' | 'edition'; id: string }

const OPEN_LIBRARY_BASE = 'https://openlibrary.org'
const OPEN_LIBRARY_COVER_BASE = 'https://covers.openlibrary.org/b'

export async function searchBooks(query: string, page = 1, pageSize = 20): Promise<ResourcePage<BookSearchItem>> {
  const url = new URL(`${OPEN_LIBRARY_BASE}/search.json`)
  url.searchParams.set('q', query)
  url.searchParams.set(
    'fields',
    [
      'key',
      'title',
      'author_name',
      'language',
      'first_publish_year',
      'cover_i',
      'isbn',
      'edition_key',
      'alternative_title',
    ].join(','),
  )
  url.searchParams.set('limit', String(pageSize))
  url.searchParams.set('page', String(page))

  const payload = await fetchOpenLibraryJson<OpenLibrarySearchResponse>(url, { notFoundStatus: 502 })
  if (payload.docs !== undefined && !Array.isArray(payload.docs)) {
    throw new BookProviderError('Open Library search response has invalid docs.', 502)
  }
  const results = (payload.docs ?? []).map(toBookSearchItem).filter((item): item is BookSearchItem => item !== null)
  return toResourcePage(results, page, pageSize, payload.numFound)
}

export async function discoverBooks(input: BookDiscoveryInput): Promise<ResourcePage<BookSearchItem>> {
  if (input.mode === 'subject' && input.subject) {
    const url = new URL(`${OPEN_LIBRARY_BASE}/subjects/${encodeURIComponent(input.subject)}.json`)
    url.searchParams.set('limit', String(input.pageSize))
    url.searchParams.set('offset', String((input.page - 1) * input.pageSize))

    const payload = await fetchOpenLibraryJson<OpenLibrarySubjectResponse>(url, { notFoundStatus: 502 })
    if (payload.works !== undefined && !Array.isArray(payload.works)) {
      throw new BookProviderError('Open Library subject response has invalid works.', 502)
    }
    const results = (payload.works ?? []).map(toBookSearchItem).filter((item): item is BookSearchItem => item !== null)
    return toResourcePage(results, input.page, input.pageSize, payload.work_count)
  }

  const url = new URL(`${OPEN_LIBRARY_BASE}/trending/${input.period}.json`)
  url.searchParams.set('limit', String(input.pageSize))
  url.searchParams.set('page', String(input.page))

  const payload = await fetchOpenLibraryJson<OpenLibraryTrendingResponse>(url, { notFoundStatus: 502 })
  if (payload.works !== undefined && !Array.isArray(payload.works)) {
    throw new BookProviderError('Open Library trending response has invalid works.', 502)
  }
  const results = (payload.works ?? []).map(toBookSearchItem).filter((item): item is BookSearchItem => item !== null)
  return toResourcePage(results, input.page, input.pageSize)
}

export async function getBookDetails(mediaKey: string): Promise<BookDetails> {
  const key = parseBookMediaKey(mediaKey)
  if (!key) throw new BookProviderError(`Unsupported book media key: ${mediaKey}`, 400)

  if (key.provider === 'isbn') {
    const edition = await fetchOpenLibraryJson<OpenLibraryEditionResponse>(`${OPEN_LIBRARY_BASE}/isbn/${key.id}.json`)
    return toBookDetailsFromEdition(key.id, edition)
  }

  if (key.resourceType === 'edition') {
    const edition = await fetchOpenLibraryJson<OpenLibraryEditionResponse>(`${OPEN_LIBRARY_BASE}/books/${key.id}.json`)
    return toBookDetailsFromEdition(null, edition)
  }

  const work = await fetchOpenLibraryJson<OpenLibraryWorkResponse>(`${OPEN_LIBRARY_BASE}/works/${key.id}.json`)
  return toBookDetailsFromWork(work)
}

function parseBookMediaKey(mediaKey: string): BookMediaKey | null {
  const parts = parseMediaKey(mediaKey)
  if (parts?.provider === 'isbn' && parts.resourceType === 'book') {
    const isbn = normalizeIsbn(parts.id)
    return isbn ? { provider: 'isbn', resourceType: 'book', id: isbn } : null
  }
  if (parts?.provider === 'openlibrary' && (parts.resourceType === 'work' || parts.resourceType === 'edition')) {
    const id = parseOpenLibraryId(parts.id, parts.resourceType)
    return id ? { provider: 'openlibrary', resourceType: parts.resourceType, id } : null
  }
  return null
}

async function toBookDetailsFromEdition(
  requestedIsbn: string | null,
  edition: OpenLibraryEditionResponse,
): Promise<BookDetails> {
  const editionId = parseOpenLibraryId(edition.key, 'edition')
  if (!editionId || !edition.title)
    throw new BookProviderError('Open Library edition response is missing required fields.', 502)

  const workId = parseOpenLibraryId(edition.works?.[0]?.key, 'work')
  const [work, authors] = await Promise.all([
    workId
      ? fetchOpenLibraryJson<OpenLibraryWorkResponse>(`${OPEN_LIBRARY_BASE}/works/${workId}.json`, {
          notFoundStatus: 502,
        })
      : null,
    listAuthorNames(edition.authors?.map((author) => author.key) ?? []),
  ])
  const editions = workId ? await listWorkEditions(workId) : [edition]
  const isbnCandidates = uniqueStrings([
    ...(requestedIsbn ? [requestedIsbn] : []),
    ...getEditionIsbns(edition),
    ...editions.flatMap(getEditionIsbns),
  ])
  const aliases = getTitleAliases(edition.title, [
    work?.title,
    work?.subtitle,
    ...(work?.other_titles ?? []),
    edition.subtitle,
    ...(edition.other_titles ?? []),
    ...editions.map((item) => item.title),
    ...editions.flatMap((item) => item.other_titles ?? []),
  ])
  const firstPublishYear = firstYear([work?.first_publish_date, edition.publish_date])

  return {
    mediaKey: requestedIsbn
      ? buildMediaKey({ provider: 'isbn', resourceType: 'book', id: requestedIsbn })
      : buildMediaKey({ provider: 'openlibrary', resourceType: 'edition', id: editionId }),
    title: edition.title,
    authors,
    languages: uniqueStrings([...getEditionLanguages(edition), ...editions.flatMap(getEditionLanguages)]),
    firstPublishYear,
    coverUrl: getPrimaryCoverUrl(firstCoverIds(edition, work)),
    isbnCandidates,
    editionKeys: uniqueStrings([editionId, ...editions.map((item) => parseOpenLibraryId(item.key, 'edition') ?? '')]),
    aliases,
    description: getDescription(work?.description),
    covers: toBookCovers(firstCoverIds(edition, work) ?? []),
    workKey: workId ? buildMediaKey({ provider: 'openlibrary', resourceType: 'work', id: workId }) : null,
    editionKey: buildMediaKey({ provider: 'openlibrary', resourceType: 'edition', id: editionId }),
    editionCandidates: toEditionCandidates(editions),
  }
}

async function toBookDetailsFromWork(work: OpenLibraryWorkResponse): Promise<BookDetails> {
  const workId = parseOpenLibraryId(work.key, 'work')
  if (!workId || !work.title) throw new BookProviderError('Open Library work response is missing required fields.', 502)

  const [authors, editions] = await Promise.all([
    listAuthorNames(work.authors?.map((author) => author.author?.key) ?? []),
    listWorkEditions(workId),
  ])
  const isbnCandidates = uniqueStrings(editions.flatMap(getEditionIsbns))
  const editionKeys = uniqueStrings(editions.map((edition) => parseOpenLibraryId(edition.key, 'edition') ?? ''))

  return {
    mediaKey: buildMediaKey({ provider: 'openlibrary', resourceType: 'work', id: workId }),
    title: work.title,
    authors,
    languages: uniqueStrings(editions.flatMap(getEditionLanguages)),
    firstPublishYear: firstYear([work.first_publish_date, ...editions.map((edition) => edition.publish_date)]),
    coverUrl: getPrimaryCoverUrl(firstCoverIds(work, ...editions)),
    isbnCandidates,
    editionKeys,
    aliases: getTitleAliases(work.title, [
      work.subtitle,
      ...(work.other_titles ?? []),
      ...editions.map((edition) => edition.title),
      ...editions.flatMap((edition) => edition.other_titles ?? []),
    ]),
    description: getDescription(work.description),
    covers: toBookCovers(firstCoverIds(work, ...editions) ?? []),
    workKey: buildMediaKey({ provider: 'openlibrary', resourceType: 'work', id: workId }),
    editionKey: editionKeys[0]
      ? buildMediaKey({ provider: 'openlibrary', resourceType: 'edition', id: editionKeys[0] })
      : null,
    editionCandidates: toEditionCandidates(editions),
  }
}

function toBookSearchItem(doc: OpenLibrarySearchDoc): BookSearchItem | null {
  if (!doc.key || !doc.title) return null
  const workId = parseOpenLibraryId(doc.key, 'work')
  if (!workId) return null

  const isbnCandidates = uniqueStrings(
    (doc.isbn ?? []).map(normalizeIsbn).filter((isbn): isbn is string => Boolean(isbn)),
  )
  const mediaKey = isbnCandidates[0]
    ? buildMediaKey({ provider: 'isbn', resourceType: 'book', id: isbnCandidates[0] })
    : buildMediaKey({ provider: 'openlibrary', resourceType: 'work', id: workId })

  return {
    mediaKey,
    title: doc.title,
    authors: uniqueStrings(doc.author_name ?? []),
    languages: uniqueStrings(doc.language ?? []),
    firstPublishYear: typeof doc.first_publish_year === 'number' ? doc.first_publish_year : null,
    coverUrl: typeof doc.cover_i === 'number' ? coverUrl('id', String(doc.cover_i), 'M') : null,
    isbnCandidates,
    editionKeys: uniqueStrings((doc.edition_key ?? []).map((key) => parseOpenLibraryId(key, 'edition') ?? '')),
    aliases: uniqueStrings(doc.alternative_title ?? [])
      .filter((title) => title !== doc.title)
      .slice(0, 8),
  }
}

function toResourcePage<T>(
  results: T[],
  page: number,
  pageSize: number,
  totalResults = results.length === pageSize ? page * pageSize + 1 : (page - 1) * pageSize + results.length,
): ResourcePage<T> {
  return {
    results,
    page,
    totalPages: Math.max(page, Math.ceil(totalResults / pageSize)),
    totalResults,
  }
}

async function listWorkEditions(workId: string): Promise<OpenLibraryEditionResponse[]> {
  const url = new URL(`${OPEN_LIBRARY_BASE}/works/${workId}/editions.json`)
  url.searchParams.set('limit', '20')
  const payload = await fetchOpenLibraryJson<OpenLibraryEditionsResponse>(url, { notFoundStatus: 502 })
  if (payload.entries !== undefined && !Array.isArray(payload.entries)) {
    throw new BookProviderError('Open Library editions response has invalid entries.', 502)
  }
  return payload.entries ?? []
}

async function listAuthorNames(keys: Array<string | undefined>): Promise<string[]> {
  const authorIds = uniqueStrings(keys.map((key) => parseOpenLibraryId(key, 'author') ?? ''))
  const authors = await Promise.all(
    authorIds.map((id) =>
      fetchOpenLibraryJson<OpenLibraryAuthorResponse>(`${OPEN_LIBRARY_BASE}/authors/${id}.json`, {
        notFoundStatus: 502,
      }),
    ),
  )
  return uniqueStrings(authors.map((author) => author.name ?? ''))
}

async function fetchOpenLibraryJson<T>(input: URL | string, options: { notFoundStatus?: 404 | 502 } = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(input, { headers: { Accept: 'application/json' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network request failed.'
    throw new BookProviderError(`Open Library request failed: ${message}`, 502)
  }

  if (response.status === 404) {
    const status = options.notFoundStatus ?? 404
    const message = status === 404 ? 'Book not found in Open Library.' : 'Open Library request failed: 404'
    throw new BookProviderError(message, status)
  }
  if (!response.ok) throw new BookProviderError(`Open Library request failed: ${response.status}`, 502)

  try {
    return (await response.json()) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON response.'
    throw new BookProviderError(`Open Library returned invalid JSON: ${message}`, 502)
  }
}

function toEditionCandidates(editions: OpenLibraryEditionResponse[]): BookEditionCandidate[] {
  return editions
    .map((edition) => {
      const id = parseOpenLibraryId(edition.key, 'edition')
      if (!id) return null
      return {
        mediaKey: buildMediaKey({ provider: 'openlibrary', resourceType: 'edition', id }),
        openLibraryId: id,
        title: edition.title?.trim() || null,
        publishYear: firstYear([edition.publish_date]),
        languages: getEditionLanguages(edition),
        isbnCandidates: getEditionIsbns(edition),
      }
    })
    .filter((edition): edition is BookEditionCandidate => edition !== null)
}

function getEditionIsbns(edition: OpenLibraryEditionResponse): string[] {
  return uniqueStrings([...(edition.isbn_13 ?? []), ...(edition.isbn_10 ?? [])].map(normalizeIsbn).filter(Boolean))
}

function getEditionLanguages(edition: OpenLibraryEditionResponse): string[] {
  return uniqueStrings(
    (edition.languages ?? [])
      .map((language) => language.key?.split('/').pop()?.trim())
      .filter((language): language is string => Boolean(language)),
  )
}

function toBookCovers(ids: number[]): BookCover[] {
  const id = ids.find((value) => Number.isInteger(value) && value > 0)
  if (!id) return []
  return [
    { source: 'openlibrary', size: 'small', url: coverUrl('id', String(id), 'S') },
    { source: 'openlibrary', size: 'medium', url: coverUrl('id', String(id), 'M') },
    { source: 'openlibrary', size: 'large', url: coverUrl('id', String(id), 'L') },
  ]
}

function firstCoverIds(...items: Array<{ covers?: number[] } | null | undefined>): number[] | null {
  return items.find((item) => item?.covers?.length)?.covers ?? null
}

function getPrimaryCoverUrl(ids: number[] | null): string | null {
  const id = ids?.find((value) => Number.isInteger(value) && value > 0)
  return id ? coverUrl('id', String(id), 'M') : null
}

function coverUrl(kind: 'id' | 'isbn' | 'olid', id: string, size: 'S' | 'M' | 'L'): string {
  return `${OPEN_LIBRARY_COVER_BASE}/${kind}/${encodeURIComponent(id)}-${size}.jpg`
}

function getTitleAliases(title: string, values: Array<string | null | undefined>): string[] {
  return uniqueStrings(values)
    .filter((value) => value !== title)
    .slice(0, 8)
}

function getDescription(value: OpenLibraryWorkResponse['description']): string | null {
  if (typeof value === 'string') return value.trim() || null
  return value?.value?.trim() || null
}

function firstYear(values: Array<string | undefined>): number | null {
  const years = values
    .map((value) => value?.match(/\b(1[0-9]{3}|20[0-9]{2})\b/)?.[1])
    .filter((year): year is string => Boolean(year))
    .map(Number)
  return years.length > 0 ? Math.min(...years) : null
}

function normalizeIsbn(value: string | undefined): string | null {
  const isbn = value?.replace(/[\s-]+/g, '').toUpperCase()
  if (!isbn) return null
  if (/^\d{9}[\dX]$/.test(isbn) || /^\d{13}$/.test(isbn)) return isbn
  return null
}

function parseOpenLibraryId(value: string | undefined, kind: 'work' | 'edition' | 'author'): string | null {
  const id = value?.split('/').pop()?.trim()
  if (!id) return null
  if (kind === 'work' && /^OL\d+W$/.test(id)) return id
  if (kind === 'edition' && /^OL\d+M$/.test(id)) return id
  if (kind === 'author' && /^OL\d+A$/.test(id)) return id
  return null
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]
}

export const openLibraryBookProvider: BookProvider = {
  search: (query, page, pageSize) => searchBooks(query, page, pageSize),
  discover: (input) => discoverBooks(input),
  details: (mediaKey) => getBookDetails(mediaKey),
}
