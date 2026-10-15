import { zValidator } from '@hono/zod-validator'
import { MusicProviderError } from '@server/usecases/ports'
import { buildMusicBrainzMediaKey, parseMusicBrainzMediaKey } from '@shared/media-key'
import type { CatalogAlbum, CatalogAlbumEdition, MusicAlbumDetails } from '@shared/types'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import { catalogHref, catalogItem, catalogPage } from './catalog-representations'
import type { AppEnv } from './context'
import { pageRepresentation, problem, setPageLinks } from './protocol'

const paging = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(20),
})
const albumQuery = paging
  .extend({
    q: z.string().trim().min(1).optional(),
    artist: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).optional(),
    genre: z.enum(['rock', 'jazz', 'electronic', 'hip-hop', 'classical', 'pop', 'metal']).optional(),
    releaseType: z.enum(['album', 'ep', 'single']).default('album'),
    year: z
      .string()
      .regex(/^(19|20)\d{2}$/)
      .optional(),
  })
  .strict()
  .refine(
    (value) => value.q || value.artist || value.title || value.genre || value.year,
    'At least one album search field is required',
  )
const keySchema = (type: 'release-group' | 'release' | 'recording') =>
  z
    .string()
    .trim()
    .refine((value) => parseMusicBrainzMediaKey(value)?.resourceType === type, `A ${type} identifier is required`)
const albumParams = z.object({ mediaKey: keySchema('release-group') })
const editionParams = z.object({ mediaKey: keySchema('release') })
const discParams = editionParams.extend({ discNumber: z.coerce.number().int().positive() })
const trackParams = discParams.extend({ trackNumber: z.coerce.number().int().positive() })

export function registerMusicRoutes(routes: Hono<AppEnv>) {
  routes.get('/albums', zValidator('query', albumQuery), async (c) => {
    try {
      const input = c.req.valid('query')
      return c.json(catalogPage(c, await c.get('deps').musicProvider.search(input), input.pageSize, false))
    } catch (error) {
      return musicProviderErrorResponse(c, error)
    }
  })

  routes.get('/albums/:mediaKey', zValidator('param', albumParams), async (c) => {
    try {
      return c.json(
        albumRepresentation(
          c,
          await c.get('deps').musicProvider.details(c.req.valid('param').mediaKey),
          c.req.valid('param').mediaKey,
        ),
      )
    } catch (error) {
      return musicProviderErrorResponse(c, error)
    }
  })

  routes.get('/albums/:mediaKey/editions', zValidator('param', albumParams), zValidator('query', paging), async (c) => {
    try {
      const { page, pageSize } = c.req.valid('query')
      const albumKey = c.req.valid('param').mediaKey
      const result = await c.get('deps').musicProvider.editions(albumKey, page, pageSize)
      setPageLinks(c, { page, pageSize }, result.totalResults)
      return c.json(
        pageRepresentation(
          result.results.map((edition) => ({
            ...edition,
            links: {
              self: catalogHref(c, `/album-editions/${encodeURIComponent(edition.mediaKey)}`),
              album: catalogHref(c, `/albums/${encodeURIComponent(albumKey)}`),
            },
          })),
          page,
          pageSize,
          result.totalResults,
          result.totalPages,
        ),
      )
    } catch (error) {
      return musicProviderErrorResponse(c, error)
    }
  })

  routes.get('/album-editions/:mediaKey', zValidator('param', editionParams), async (c) => {
    try {
      return c.json(
        albumRepresentation(
          c,
          await c.get('deps').musicProvider.details(c.req.valid('param').mediaKey),
          c.req.valid('param').mediaKey,
        ),
      )
    } catch (error) {
      return musicProviderErrorResponse(c, error)
    }
  })

  routes.get('/album-editions/:mediaKey/discs', zValidator('param', editionParams), async (c) => {
    try {
      const key = c.req.valid('param').mediaKey
      const item = await c.get('deps').musicProvider.details(key)
      return c.json({ items: item.media.map((disc) => discRepresentation(c, key, disc)) })
    } catch (error) {
      return musicProviderErrorResponse(c, error)
    }
  })

  routes.get('/album-editions/:mediaKey/discs/:discNumber', zValidator('param', discParams), async (c) => {
    try {
      const { mediaKey, discNumber } = c.req.valid('param')
      const item = await c.get('deps').musicProvider.details(mediaKey)
      const disc = item.media.find((value) => value.position === discNumber)
      return disc ? c.json(discRepresentation(c, mediaKey, disc)) : problem(c, 404, 'not-found', 'Disc not found')
    } catch (error) {
      return musicProviderErrorResponse(c, error)
    }
  })

  routes.get('/album-editions/:mediaKey/discs/:discNumber/tracks', zValidator('param', discParams), async (c) => {
    try {
      const { mediaKey, discNumber } = c.req.valid('param')
      const item = await c.get('deps').musicProvider.details(mediaKey)
      const disc = item.media.find((value) => value.position === discNumber)
      if (!disc) return problem(c, 404, 'not-found', 'Disc not found')
      return c.json({ items: disc.tracks.map((track) => trackRepresentation(c, mediaKey, discNumber, track)) })
    } catch (error) {
      return musicProviderErrorResponse(c, error)
    }
  })

  routes.get(
    '/album-editions/:mediaKey/discs/:discNumber/tracks/:trackNumber',
    zValidator('param', trackParams),
    async (c) => {
      try {
        const { mediaKey, discNumber, trackNumber } = c.req.valid('param')
        const item = await c.get('deps').musicProvider.details(mediaKey)
        const track = item.media
          .find((value) => value.position === discNumber)
          ?.tracks.find((value) => value.position === trackNumber)
        return track
          ? c.json(trackRepresentation(c, mediaKey, discNumber, track))
          : problem(c, 404, 'not-found', 'Track not found')
      } catch (error) {
        return musicProviderErrorResponse(c, error)
      }
    },
  )

  routes.get(
    '/recordings/:mediaKey',
    zValidator('param', z.object({ mediaKey: keySchema('recording') })),
    async (c) => {
      try {
        const item = await c.get('deps').musicProvider.recording(c.req.valid('param').mediaKey)
        return c.json({
          ...item,
          links: { self: catalogHref(c, `/recordings/${encodeURIComponent(item.mediaKey)}`) },
          albumEditions: item.albumEditions.map((edition) => ({
            ...edition,
            links: { self: catalogHref(c, `/album-editions/${encodeURIComponent(edition.mediaKey)}`) },
          })),
        })
      } catch (error) {
        return musicProviderErrorResponse(c, error)
      }
    },
  )
}

function albumRepresentation(
  c: Context<AppEnv>,
  item: MusicAlbumDetails,
  mediaKey: string,
): CatalogAlbum | CatalogAlbumEdition {
  const {
    detailMediaKey: _detailKey,
    releaseMbid: _releaseId,
    preferredRelease,
    releases: _releases,
    media,
    formats,
    aliases,
    barcode,
    ...summary
  } = item
  const albumKey = buildMusicBrainzMediaKey('release-group', item.releaseGroupMbid)
  const edition: CatalogAlbumEdition | null = preferredRelease
    ? {
        ...catalogItem(c, {
          ...summary,
          mediaKey: preferredRelease.mediaKey,
          resourceType: 'release' as const,
          mbid: preferredRelease.mbid,
        }),
        title: preferredRelease.title,
        albumMediaKey: albumKey,
        aliases,
        formats,
        barcode,
        status: preferredRelease.status,
        discs: media.map((disc) => discRepresentation(c, preferredRelease.mediaKey, disc)),
        links: {
          self: catalogHref(c, `/album-editions/${encodeURIComponent(preferredRelease.mediaKey)}`),
          album: catalogHref(c, `/albums/${encodeURIComponent(albumKey)}`),
          discs: catalogHref(c, `/album-editions/${encodeURIComponent(preferredRelease.mediaKey)}/discs`),
        },
      }
    : null
  if (parseMusicBrainzMediaKey(mediaKey)?.resourceType === 'release') {
    if (!edition) throw new MusicProviderError('Album edition metadata is missing.', 502, 'MUSICBRAINZ_REQUEST_FAILED')
    return edition
  }
  return {
    ...catalogItem(c, {
      ...summary,
      mediaKey: albumKey,
      resourceType: 'release-group' as const,
      mbid: item.releaseGroupMbid,
      releaseDate: item.firstReleaseDate,
      country: null,
    }),
    aliases,
    preferredEdition: edition,
  }
}

function discRepresentation(c: Context<AppEnv>, key: string, disc: MusicAlbumDetails['media'][number]) {
  const self = catalogHref(c, `/album-editions/${encodeURIComponent(key)}/discs/${disc.position}`)
  return {
    ...disc,
    links: {
      self,
      tracks: `${self}/tracks`,
      albumEdition: catalogHref(c, `/album-editions/${encodeURIComponent(key)}`),
    },
  }
}

function trackRepresentation(
  c: Context<AppEnv>,
  key: string,
  discNumber: number,
  track: MusicAlbumDetails['media'][number]['tracks'][number],
) {
  const disc = catalogHref(c, `/album-editions/${encodeURIComponent(key)}/discs/${discNumber}`)
  return {
    ...track,
    links: {
      self: `${disc}/tracks/${track.position}`,
      disc,
      ...(track.recordingMediaKey
        ? { recording: catalogHref(c, `/recordings/${encodeURIComponent(track.recordingMediaKey)}`) }
        : {}),
    },
  }
}

function musicProviderErrorResponse(c: Context<AppEnv>, error: unknown) {
  if (!(error instanceof MusicProviderError)) throw error
  return problem(
    c,
    error.status as 400 | 404 | 429 | 502,
    error.status === 404 ? 'not-found' : error.status === 400 ? 'validation-error' : 'upstream-unavailable',
    error.status === 404
      ? 'Music resource not found'
      : error.status === 400
        ? error.message
        : 'The music provider is unavailable',
  )
}
