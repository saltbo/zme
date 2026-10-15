import { zValidator } from '@hono/zod-validator'
import { BookProviderError } from '@server/usecases/ports'
import { parseMediaKey } from '@shared/media-key'
import type { BookDetails } from '@shared/types'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import { catalogHref, catalogItem, catalogPage } from './catalog-representations'
import type { AppEnv } from './context'
import { pageRepresentation, problem, setPageLinks } from './protocol'

const paging = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(20),
})
const bookQuery = paging
  .extend({
    q: z.string().trim().min(1).optional(),
    subject: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.q) !== Boolean(value.subject), 'Provide either q or subject')
export const mediaKeyParamsSchema = z.object({ mediaKey: z.string().trim().min(1) })
const workParams = z.object({ mediaKey: z.string().regex(/^openlibrary:work:OL[0-9]+W$/) })
const editionParams = z.object({ mediaKey: z.string().regex(/^openlibrary:edition:OL[0-9]+M$/) })

export function registerBookRoutes(routes: Hono<AppEnv>) {
  routes.get('/books', zValidator('query', bookQuery), async (c) => {
    const input = c.req.valid('query')
    try {
      const result = input.q
        ? await c.get('deps').bookProvider.search(input.q, input.page, input.pageSize)
        : await c.get('deps').bookProvider.discover({
            mode: 'subject',
            subject: input.subject,
            period: 'daily',
            page: input.page,
            pageSize: input.pageSize,
          })
      return c.json(catalogPage(c, result, input.pageSize))
    } catch (error) {
      return bookProviderErrorResponse(c, error)
    }
  })

  routes.get('/books/:mediaKey', zValidator('param', workParams), async (c) => {
    try {
      return c.json(bookRepresentation(c, await c.get('deps').bookProvider.details(c.req.valid('param').mediaKey)))
    } catch (error) {
      return bookProviderErrorResponse(c, error)
    }
  })

  routes.get('/books/:mediaKey/editions', zValidator('param', workParams), zValidator('query', paging), async (c) => {
    const { page, pageSize } = c.req.valid('query')
    try {
      const result = await c.get('deps').bookProvider.editions(c.req.valid('param').mediaKey, page, pageSize)
      setPageLinks(c, { page, pageSize }, result.totalResults)
      return c.json(
        pageRepresentation(
          result.results.map((edition) => ({
            ...edition,
            links: {
              self: catalogHref(c, `/book-editions/${encodeURIComponent(edition.mediaKey)}`),
              book: catalogHref(c, `/books/${encodeURIComponent(c.req.valid('param').mediaKey)}`),
            },
          })),
          page,
          pageSize,
          result.totalResults,
          result.totalPages,
        ),
      )
    } catch (error) {
      return bookProviderErrorResponse(c, error)
    }
  })

  routes.get(
    '/book-editions',
    zValidator(
      'query',
      z
        .object({
          isbn: z
            .string()
            .trim()
            .regex(/^(?:[0-9]{9}[0-9Xx]|[0-9]{13})$/),
        })
        .strict(),
    ),
    async (c) => {
      try {
        const item = await c.get('deps').bookProvider.details(`isbn:book:${c.req.valid('query').isbn}`)
        return c.json({ items: [bookRepresentation(c, item)] })
      } catch (error) {
        return bookProviderErrorResponse(c, error)
      }
    },
  )

  routes.get('/book-editions/:mediaKey', zValidator('param', editionParams), async (c) => {
    try {
      return c.json(bookRepresentation(c, await c.get('deps').bookProvider.details(c.req.valid('param').mediaKey)))
    } catch (error) {
      return bookProviderErrorResponse(c, error)
    }
  })
}

function bookRepresentation(c: Context<AppEnv>, item: BookDetails) {
  const key = parseMediaKey(item.mediaKey)
  const mediaKey = key?.provider === 'isbn' ? item.editionKey : item.mediaKey
  if (!mediaKey) throw new BookProviderError('Book edition has no canonical identifier.', 502)
  const result = catalogItem(c, { ...item, mediaKey })
  if (item.workKey && mediaKey !== item.workKey)
    result.links.book = catalogHref(c, `/books/${encodeURIComponent(item.workKey)}`)
  return result
}

function bookProviderErrorResponse(c: Context<AppEnv>, error: unknown) {
  if (!(error instanceof BookProviderError)) throw error
  const status = error.status === 400 || error.status === 404 ? error.status : 502
  return problem(
    c,
    status,
    status === 404 ? 'not-found' : status === 400 ? 'validation-error' : 'upstream-unavailable',
    status === 404 ? 'Book not found' : status === 400 ? error.message : 'The book provider is unavailable',
  )
}
