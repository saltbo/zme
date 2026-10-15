import { apiResourcePage, query } from './client'

export async function readChartEntries<T>(
  chartId: string,
  input: { period?: string; language?: string; page?: number; pageSize?: number },
) {
  const page = await apiResourcePage<{ rank: number; item: T }>(
    `/api/charts/${chartId}/entries${query(input)}`,
    'Failed to load chart.',
  )
  return { ...page, results: page.results.map(({ item }) => item) }
}
