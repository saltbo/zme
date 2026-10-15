import { zValidator } from '@hono/zod-validator'
import { chartDefinitions } from '@server/usecases/charts'
import { getActiveTmdbSource } from '@server/usecases/media-sources'
import { BookProviderError, MusicProviderError } from '@server/usecases/ports'
import type { BookSearchItem, MediaSearchItem, MusicSearchItem, ResourcePage } from '@shared/types'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import { catalogItem } from './catalog-representations'
import type { AppEnv } from './context'
import { problem, setPageLinks } from './protocol'

const entriesQuery = z
  .object({
    period: z.enum(['day', 'week', 'month', 'year', 'all']).optional(),
    language: z.string().trim().min(2).max(35).optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().min(1).max(60).default(20),
  })
  .strict()

export function registerChartRoutes(routes: Hono<AppEnv>) {
  routes.get('/charts', (c) => c.json({ items: chartDefinitions.map((chart) => representation(c, chart)) }))
  routes.get('/charts/:chartId', (c) => {
    const chart = chartDefinitions.find(({ id }) => id === c.req.param('chartId'))
    return chart ? c.json(representation(c, chart)) : problem(c, 404, 'not-found', 'Chart not found')
  })
  routes.get('/charts/:chartId/entries', zValidator('query', entriesQuery), async (c) => {
    const chart = chartDefinitions.find(({ id }) => id === c.req.param('chartId'))
    if (!chart) return problem(c, 404, 'not-found', 'Chart not found')
    const input = c.req.valid('query')
    const period = input.period ?? ('defaultPeriod' in chart ? chart.defaultPeriod : undefined)
    if (period && !(chart.periods as readonly string[]).includes(period)) {
      return problem(c, 422, 'validation-error', 'The requested period is not supported by this chart')
    }
    if (chart.source === 'tmdb' && input.pageSize !== 20) {
      return problem(c, 422, 'validation-error', 'Screen charts use a page size of 20')
    }
    let result: ResourcePage<MediaSearchItem | BookSearchItem | MusicSearchItem>
    let ranks: number[] | undefined
    try {
      const deps = c.get('deps')
      if (chart.source === 'tmdb') {
        const source = await getActiveTmdbSource(deps, input.language)
        const chartPage = await deps.mediaProvider.chartPage(source, {
          chart: chart.id === 'screen-trending' ? 'trending' : 'popular',
          kind: chart.id === 'movies-popular' ? 'movie' : chart.id === 'series-popular' ? 'tv' : undefined,
          period: period as 'day' | 'week' | undefined,
          page: input.page,
        })
        result = chartPage
        ranks = chartPage.ranks
      } else if (chart.source === 'openlibrary') {
        const periods = { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' } as const
        result = await deps.bookProvider.discover({
          mode: 'trending',
          period: periods[period as keyof typeof periods],
          page: input.page,
          pageSize: input.pageSize,
        })
      } else {
        result = await deps.musicProvider.discover({
          mode: 'popular',
          range: period === 'all' ? 'all_time' : (period as 'week' | 'month' | 'year'),
          chartType: chart.id === 'recordings-popular' ? 'tracks' : 'albums',
          releaseType: 'album',
          page: input.page,
          pageSize: input.pageSize,
        })
      }
    } catch (error) {
      if (error instanceof BookProviderError || error instanceof MusicProviderError) {
        return problem(c, error.status === 429 ? 429 : 502, 'upstream-unavailable', 'The chart provider is unavailable')
      }
      throw error
    }
    const items = result.results.map((item, index) => ({
      rank: ranks ? ranks[index] : (input.page - 1) * input.pageSize + index + 1,
      item: catalogItem(c, item),
    }))
    if (chart.source === 'tmdb') setPageLinks(c, { page: result.page, pageSize: input.pageSize }, result.totalResults)
    if (chart.source !== 'tmdb' || chart.id === 'screen-trending')
      return c.json({ items, pagination: { page: input.page, pageSize: input.pageSize } })
    return c.json({
      items,
      pagination: {
        page: result.page,
        pageSize: input.pageSize,
        totalItems: result.totalResults,
        totalPages: result.totalPages,
      },
    })
  })
}

function representation(c: Context<AppEnv>, chart: (typeof chartDefinitions)[number]) {
  const self = new URL(`/api/charts/${chart.id}`, c.req.url).toString()
  return { ...chart, links: { self, entries: `${self}/entries` } }
}
