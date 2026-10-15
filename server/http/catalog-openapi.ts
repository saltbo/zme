import { chartDefinitions } from '@server/usecases/charts'

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const string = { type: 'string' }
const links = { type: 'object', additionalProperties: { type: 'string', format: 'uri' } }
const strings = { type: 'array', items: string }
const query = (name: string, schema: object, required = false) => ({ name, in: 'query', required, schema })
const page = query('page', { type: 'integer', minimum: 1, default: 1 })
const pageSize = query('pageSize', { type: 'integer', minimum: 1, maximum: 60, default: 20 })
const screenPageSize = query('pageSize', { type: 'integer', const: 20, default: 20 })
const language = query('language', { type: 'string', minLength: 2, maxLength: 35 })
const q = query('q', { type: 'string', minLength: 1, maxLength: 200 })

export function catalogPathParameter(operationId: string, name: string): object | undefined {
  if (name === 'chartId')
    return { name, in: 'path', required: true, schema: { type: 'string', enum: chartDefinitions.map(({ id }) => id) } }
  if (name !== 'mediaKey') return undefined
  const prefixes: Record<string, string> = {
    getBook: 'openlibrary:work:OL[0-9]+W',
    listBookEditions: 'openlibrary:work:OL[0-9]+W',
    getBookEdition: 'openlibrary:edition:OL[0-9]+M',
    getAlbum: 'musicbrainz:release-group:',
    listAlbumEditions: 'musicbrainz:release-group:',
    getAlbumEdition: 'musicbrainz:release:',
    listAlbumEditionDiscs: 'musicbrainz:release:',
    getAlbumEditionDisc: 'musicbrainz:release:',
    listAlbumDiscTracks: 'musicbrainz:release:',
    getAlbumDiscTrack: 'musicbrainz:release:',
    getRecording: 'musicbrainz:recording:',
  }
  const prefix = prefixes[operationId]
  if (!prefix) return undefined
  const uuid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
  return {
    name,
    in: 'path',
    required: true,
    schema: { type: 'string', minLength: 1, pattern: `^${prefix}${prefix.startsWith('musicbrainz:') ? uuid : ''}$` },
  }
}

export function catalogQueryParameters(operationId: string): object[] | undefined {
  if (operationId === 'listCatalogItems')
    return [
      { ...q, required: true },
      query('types', {
        type: 'string',
        enum: ['movie', 'series', 'movie,series', 'series,movie'],
        default: 'movie,series',
      }),
      language,
      page,
      screenPageSize,
    ]
  if (operationId === 'listMovies' || operationId === 'listSeries')
    return [
      q,
      language,
      page,
      screenPageSize,
      query('orderBy', { type: 'string', enum: ['popularity desc', 'rating desc', 'releaseDate desc'] }),
      query('genreId', { type: 'integer', minimum: 1 }),
      query('originCountry', { type: 'string', pattern: '^[A-Z]{2}$' }),
      query('year', { type: 'integer', minimum: 1900, maximum: new Date().getUTCFullYear() + 2 }),
      query('ratingGte', { type: 'number', minimum: 0, maximum: 10 }),
    ]
  if (operationId === 'listGenres')
    return [query('mediaType', { type: 'string', enum: ['movie', 'series'] }, true), language]
  if (operationId === 'listBooks') return [q, query('subject', { type: 'string', minLength: 1 }), page, pageSize]
  if (operationId === 'listBookEditionsByIsbn')
    return [query('isbn', { type: 'string', pattern: '^(?:[0-9]{9}[0-9Xx]|[0-9]{13})$' }, true)]
  if (operationId === 'listAlbums')
    return [
      q,
      query('artist', { type: 'string', minLength: 1 }),
      query('title', { type: 'string', minLength: 1 }),
      query('genre', { type: 'string', enum: ['rock', 'jazz', 'electronic', 'hip-hop', 'classical', 'pop', 'metal'] }),
      query('releaseType', { type: 'string', enum: ['album', 'ep', 'single'], default: 'album' }),
      query('year', { type: 'string', pattern: '^(19|20)\\d{2}$' }),
      page,
      pageSize,
    ]
  if (operationId === 'listBookEditions' || operationId === 'listAlbumEditions') return [page, pageSize]
  if (operationId === 'listChartEntries')
    return [
      query('period', { type: 'string', enum: ['day', 'week', 'month', 'year', 'all'] }),
      language,
      page,
      pageSize,
    ]
  if (['getMovie', 'getSeries', 'listMovieWatchLinks', 'listSeriesWatchLinks'].includes(operationId)) {
    return [language, query('watchRegion', { type: 'string', pattern: '^[A-Z]{2}$', default: 'US' })]
  }
  if (
    [
      'getPerson',
      'listPersonCredits',
      'listSeriesSeasons',
      'getSeriesSeason',
      'listSeasonEpisodes',
      'getSeriesEpisode',
    ].includes(operationId)
  )
    return [language]
  return undefined
}

function list(name: string) {
  return { type: 'object', required: ['items'], properties: { items: { type: 'array', items: ref(name) } } }
}

function paginated(name: string) {
  return {
    type: 'object',
    required: ['items', 'pagination'],
    properties: {
      items: { type: 'array', items: ref(name) },
      pagination: {
        type: 'object',
        required: ['page', 'pageSize'],
        description: 'Exact totals are included only when the provider supplies them; absence never means zero.',
        properties: {
          page: { type: 'integer', minimum: 1 },
          pageSize: { type: 'integer', minimum: 1 },
          totalItems: { type: 'integer', minimum: 0 },
          totalPages: { type: 'integer', minimum: 0 },
        },
      },
    },
  }
}

const musicSummary = (resourceType: 'release-group' | 'release' | 'recording') => ({
  allOf: [
    ref('MusicCatalogSummary'),
    { type: 'object', properties: { resourceType: { type: 'string', const: resourceType }, links } },
  ],
})

export function catalogSchemas() {
  return {
    MovieSummary: {
      allOf: [
        ref('ScreenTitleSummary'),
        { type: 'object', required: ['mediaKey', 'links'], properties: { kind: { type: 'string', const: 'movie' } } },
      ],
    },
    SeriesSummary: {
      allOf: [
        ref('ScreenTitleSummary'),
        { type: 'object', required: ['mediaKey', 'links'], properties: { kind: { type: 'string', const: 'tv' } } },
      ],
    },
    Movie: { allOf: [ref('ScreenTitleDetails'), ref('MovieSummary')] },
    Series: { allOf: [ref('ScreenTitleDetails'), ref('SeriesSummary')] },
    MoviePage: paginated('MovieSummary'),
    SeriesPage: paginated('SeriesSummary'),
    CatalogItem: { oneOf: [ref('MovieSummary'), ref('SeriesSummary')] },
    CatalogItemPage: paginated('CatalogItem'),
    SeriesSeasonCollection: list('SeriesSeasonSummary'),
    SeriesEpisodeCollection: list('SeriesEpisode'),
    PersonCredit: {
      type: 'object',
      required: ['kind', 'media'],
      properties: { kind: { type: 'string', const: 'cast' }, media: ref('CatalogItem') },
    },
    PersonCreditCollection: list('PersonCredit'),
    BookSummary: {
      allOf: [
        ref('BookMetadata'),
        { type: 'object', properties: { mediaKey: { type: 'string', pattern: '^openlibrary:work:OL[0-9]+W$' } } },
      ],
    },
    Book: {
      allOf: [
        ref('BookSummary'),
        { type: 'object', required: ['description', 'covers', 'workKey', 'editionKey', 'editions', 'links'] },
      ],
    },
    BookEdition: {
      allOf: [
        ref('BookMetadata'),
        {
          type: 'object',
          required: ['description', 'covers', 'workKey', 'editionKey', 'editions', 'links'],
          properties: { mediaKey: { type: 'string', pattern: '^openlibrary:edition:OL[0-9]+M$' } },
        },
      ],
    },
    BookEditionPage: paginated('BookEditionSummary'),
    BookEditionCollection: list('BookEdition'),
    AlbumSummary: musicSummary('release-group'),
    AlbumEditionSummary: musicSummary('release'),
    RecordingSummary: musicSummary('recording'),
    Album: {
      allOf: [
        ref('AlbumSummary'),
        {
          type: 'object',
          required: ['aliases', 'preferredEdition', 'links'],
          properties: {
            aliases: { type: 'array', items: ref('MusicAlias') },
            preferredEdition: { anyOf: [ref('AlbumEdition'), { type: 'null' }] },
            links,
          },
        },
      ],
    },
    AlbumEdition: {
      allOf: [
        ref('AlbumEditionSummary'),
        {
          type: 'object',
          required: ['albumMediaKey', 'aliases', 'formats', 'barcode', 'status', 'discs', 'links'],
          properties: {
            albumMediaKey: string,
            aliases: { type: 'array', items: ref('MusicAlias') },
            formats: strings,
            barcode: { type: ['string', 'null'] },
            status: { type: ['string', 'null'] },
            discs: { type: 'array', items: ref('MusicMedium') },
            links,
          },
        },
      ],
    },
    MusicAlias: {
      type: 'object',
      required: ['name', 'locale', 'primary', 'type'],
      properties: {
        name: string,
        locale: { type: ['string', 'null'] },
        primary: { type: 'boolean' },
        type: { type: ['string', 'null'] },
      },
    },
    AlbumPage: paginated('AlbumSummary'),
    AlbumEditionReference: {
      type: 'object',
      required: ['mediaKey', 'mbid', 'title', 'date', 'country', 'status', 'barcode', 'formats'],
      properties: {
        mediaKey: string,
        mbid: string,
        title: string,
        date: { type: ['string', 'null'] },
        country: { type: ['string', 'null'] },
        status: { type: ['string', 'null'] },
        barcode: { type: ['string', 'null'] },
        formats: strings,
        links,
      },
    },
    AlbumEditionPage: paginated('AlbumEditionReference'),
    MusicTrack: {
      type: 'object',
      required: ['position', 'number', 'title', 'lengthMs', 'recordingMbid', 'recordingMediaKey', 'isrcs'],
      properties: {
        position: { type: 'integer', minimum: 1 },
        number: { type: ['string', 'null'] },
        title: string,
        lengthMs: { type: ['integer', 'null'], minimum: 0 },
        recordingMbid: { type: ['string', 'null'] },
        recordingMediaKey: { type: ['string', 'null'] },
        isrcs: strings,
        links,
      },
    },
    MusicMedium: {
      type: 'object',
      required: ['position', 'format', 'title', 'trackCount', 'tracks'],
      properties: {
        position: { type: 'integer', minimum: 1 },
        format: { type: ['string', 'null'] },
        title: { type: ['string', 'null'] },
        trackCount: { type: 'integer', minimum: 0 },
        tracks: { type: 'array', items: ref('MusicTrack') },
        links,
      },
    },
    AlbumDiscCollection: list('MusicMedium'),
    AlbumTrackCollection: list('MusicTrack'),
    Recording: {
      type: 'object',
      required: ['mediaKey', 'title', 'artists', 'durationMs', 'isrcs', 'albumEditions', 'links'],
      properties: {
        mediaKey: string,
        title: string,
        artists: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'name', 'joinPhrase'],
            properties: { id: { type: ['string', 'null'] }, name: string, joinPhrase: string },
          },
        },
        durationMs: { type: ['integer', 'null'], minimum: 0 },
        isrcs: strings,
        links,
        albumEditions: {
          type: 'array',
          items: {
            type: 'object',
            required: ['mediaKey', 'title', 'links'],
            properties: { mediaKey: string, title: string, links },
          },
        },
      },
    },
    Chart: {
      type: 'object',
      required: ['id', 'title', 'itemTypes', 'periods', 'source', 'links'],
      properties: {
        id: { type: 'string', enum: chartDefinitions.map(({ id }) => id) },
        title: string,
        itemTypes: strings,
        periods: strings,
        defaultPeriod: string,
        source: { type: 'string', enum: ['tmdb', 'openlibrary', 'listenbrainz'] },
        links,
      },
    },
    ChartCollection: list('Chart'),
    ChartEntry: {
      type: 'object',
      required: ['rank', 'item'],
      properties: {
        rank: { type: 'integer', minimum: 1 },
        item: {
          oneOf: [
            ref('MovieSummary'),
            ref('SeriesSummary'),
            ref('BookSummary'),
            ref('AlbumEditionSummary'),
            ref('RecordingSummary'),
          ],
        },
      },
    },
    ChartEntryPage: paginated('ChartEntry'),
  }
}
