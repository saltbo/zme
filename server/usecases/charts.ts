export const chartDefinitions = [
  {
    id: 'screen-trending',
    title: 'Trending movies and series',
    itemTypes: ['movie', 'series'],
    periods: ['day', 'week'],
    defaultPeriod: 'day',
    source: 'tmdb',
  },
  { id: 'movies-popular', title: 'Popular movies', itemTypes: ['movie'], periods: [], source: 'tmdb' },
  { id: 'series-popular', title: 'Popular series', itemTypes: ['series'], periods: [], source: 'tmdb' },
  {
    id: 'books-trending',
    title: 'Trending books',
    itemTypes: ['book'],
    periods: ['day', 'week', 'month', 'year'],
    defaultPeriod: 'day',
    source: 'openlibrary',
  },
  {
    id: 'album-editions-popular',
    title: 'Most listened album editions',
    itemTypes: ['album-edition'],
    periods: ['week', 'month', 'year', 'all'],
    defaultPeriod: 'all',
    source: 'listenbrainz',
  },
  {
    id: 'recordings-popular',
    title: 'Most listened recordings',
    itemTypes: ['recording'],
    periods: ['week', 'month', 'year', 'all'],
    defaultPeriod: 'all',
    source: 'listenbrainz',
  },
] as const

export type ChartId = (typeof chartDefinitions)[number]['id']
