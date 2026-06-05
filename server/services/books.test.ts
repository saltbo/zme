import { afterEach, describe, expect, it, vi } from 'vitest'
import { getBookDetails, listTrendingBooks, searchBooks } from './books'

describe('Open Library book provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes search results with canonical ISBN media keys', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          docs: [
            {
              key: '/works/OL45883W',
              title: "Harry Potter and the Philosopher's Stone",
              author_name: ['J. K. Rowling'],
              language: ['eng', 'fre'],
              first_publish_year: 1997,
              cover_i: 10521270,
              isbn: ['978-0-7475-3269-9', '0747532699'],
              edition_key: ['/books/OL7353617M', 'bad-key'],
              alternative_title: ['Harry Potter 1'],
            },
          ],
        }),
      ),
    )

    const results = await searchBooks('harry potter rowling')

    expect(results).toEqual([
      {
        mediaKey: 'isbn:book:9780747532699',
        title: "Harry Potter and the Philosopher's Stone",
        authors: ['J. K. Rowling'],
        languages: ['eng', 'fre'],
        firstPublishYear: 1997,
        coverUrl: 'https://covers.openlibrary.org/b/id/10521270-M.jpg',
        isbnCandidates: ['9780747532699', '0747532699'],
        editionKeys: ['OL7353617M'],
        aliases: ['Harry Potter 1'],
      },
    ])
  })

  it('normalizes trending works as book search items', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          works: [
            {
              key: '/works/OL45883W',
              title: 'Matilda',
              author_name: ['Roald Dahl'],
              language: ['eng'],
              first_publish_year: 1988,
              cover_i: 8739161,
              edition_key: ['OL7353617M'],
            },
          ],
        }),
      ),
    )

    const results = await listTrendingBooks()

    expect(results).toEqual([
      expect.objectContaining({
        mediaKey: 'openlibrary:work:OL45883W',
        title: 'Matilda',
        authors: ['Roald Dahl'],
        coverUrl: 'https://covers.openlibrary.org/b/id/8739161-M.jpg',
      }),
    ])
  })

  it('loads ISBN details from edition and work responses', async () => {
    stubOpenLibrary({
      '/isbn/9780140328721.json': {
        key: '/books/OL7353617M',
        title: 'Matilda',
        other_titles: ['Matilda, or, The Child Genius'],
        authors: [{ key: '/authors/OL34184A' }],
        works: [{ key: '/works/OL45883W' }],
        isbn_13: ['978-0140328721'],
        languages: [{ key: '/languages/eng' }],
        covers: [],
        publish_date: '1988',
      },
      '/works/OL45883W.json': {
        key: '/works/OL45883W',
        title: 'Matilda',
        other_titles: ['Matilda the Reader'],
        description: { value: 'A clever child loves books.' },
        covers: [8739161],
        first_publish_date: '1988',
      },
      '/authors/OL34184A.json': { name: 'Roald Dahl' },
      '/works/OL45883W/editions.json?limit=20': {
        entries: [
          {
            key: '/books/OL7353617M',
            title: 'Matilda',
            isbn_13: ['9780140328721'],
            languages: [{ key: '/languages/eng' }],
            publish_date: '1988',
          },
        ],
      },
    })

    const item = await getBookDetails('isbn:book:978-0140328721')

    expect(item.mediaKey).toBe('isbn:book:9780140328721')
    expect(item.title).toBe('Matilda')
    expect(item.authors).toEqual(['Roald Dahl'])
    expect(item.languages).toEqual(['eng'])
    expect(item.firstPublishYear).toBe(1988)
    expect(item.description).toBe('A clever child loves books.')
    expect(item.aliases).toEqual(['Matilda the Reader', 'Matilda, or, The Child Genius'])
    expect(item.covers).toHaveLength(3)
    expect(item.workKey).toBe('openlibrary:work:OL45883W')
    expect(item.editionKey).toBe('openlibrary:edition:OL7353617M')
    expect(item.editionCandidates[0]).toMatchObject({
      mediaKey: 'openlibrary:edition:OL7353617M',
      isbnCandidates: ['9780140328721'],
    })
  })

  it('loads sparse work details with stable empty arrays', async () => {
    stubOpenLibrary({
      '/works/OL1W.json': {
        key: '/works/OL1W',
        title: 'Sparse Book',
      },
      '/works/OL1W/editions.json?limit=20': {
        entries: [],
      },
    })

    const item = await getBookDetails('openlibrary:work:OL1W')

    expect(item).toMatchObject({
      mediaKey: 'openlibrary:work:OL1W',
      title: 'Sparse Book',
      authors: [],
      languages: [],
      firstPublishYear: null,
      coverUrl: null,
      isbnCandidates: [],
      editionKeys: [],
      aliases: [],
      description: null,
      covers: [],
      workKey: 'openlibrary:work:OL1W',
      editionKey: null,
      editionCandidates: [],
    })
  })

  it('loads edition details by Open Library edition key', async () => {
    stubOpenLibrary({
      '/books/OL2M.json': {
        key: '/books/OL2M',
        title: 'Edition Title',
        authors: [{ key: '/authors/OL2A' }],
        isbn_10: ['0-123456-47-9'],
      },
      '/authors/OL2A.json': { name: 'Edition Author' },
    })

    const item = await getBookDetails('openlibrary:edition:OL2M')

    expect(item.mediaKey).toBe('openlibrary:edition:OL2M')
    expect(item.authors).toEqual(['Edition Author'])
    expect(item.isbnCandidates).toEqual(['0123456479'])
  })

  it('fails malformed media keys before calling Open Library', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    await expect(getBookDetails('tmdb:movie:550')).rejects.toMatchObject({ status: 400 })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('surfaces Open Library non-2xx responses as upstream errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad gateway', { status: 503 })))

    await expect(searchBooks('broken')).rejects.toMatchObject({
      status: 502,
      message: 'Open Library request failed: 503',
    })
  })

  it('maps Open Library 404 responses to not found errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })))

    await expect(getBookDetails('openlibrary:work:OL999W')).rejects.toMatchObject({
      status: 404,
      message: 'Book not found in Open Library.',
    })
  })

  it('treats enrichment 404 responses as upstream errors', async () => {
    stubOpenLibrary({
      '/books/OL2M.json': {
        key: '/books/OL2M',
        title: 'Edition Title',
        authors: [{ key: '/authors/OL404A' }],
      },
      '/authors/OL404A.json': new Response('not found', { status: 404 }),
    })

    await expect(getBookDetails('openlibrary:edition:OL2M')).rejects.toMatchObject({
      status: 502,
      message: 'Open Library request failed: 404',
    })
  })

  it('surfaces invalid Open Library search documents as upstream errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ docs: {} })))

    await expect(searchBooks('broken')).rejects.toMatchObject({
      status: 502,
      message: 'Open Library search response has invalid docs.',
    })
  })

  it('surfaces invalid Open Library JSON as upstream errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })))

    await expect(searchBooks('broken')).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('Open Library returned invalid JSON'),
    })
  })
})

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200 })
}

function stubOpenLibrary(payloads: Record<string, unknown | Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: URL | string) => {
      const url = new URL(input.toString())
      const key = `${url.pathname}${url.search}`
      if (key in payloads) {
        const payload = payloads[key]
        return Promise.resolve(payload instanceof Response ? payload : jsonResponse(payload))
      }
      throw new Error(`Unexpected Open Library URL: ${key}`)
    }),
  )
}
