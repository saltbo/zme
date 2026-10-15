import { buildTmdbMediaKey, parseMediaKey } from '@shared/media-key'
import type { BookSearchItem, MediaSearchItem, MusicSearchItem, ResourcePage } from '@shared/types'
import type { Context } from 'hono'
import type { AppEnv } from './context'
import { pageRepresentation, setPageLinks } from './protocol'

type CatalogSummary = MediaSearchItem | BookSearchItem | MusicSearchItem

export function catalogItem<T extends CatalogSummary>(c: Context<AppEnv>, item: T) {
  const mediaKey = 'mediaKey' in item ? item.mediaKey : buildTmdbMediaKey(item.kind, item.id)
  const parts = parseMediaKey(mediaKey)
  const collection =
    parts?.provider === 'tmdb'
      ? parts.resourceType === 'movie'
        ? 'movies'
        : 'series'
      : parts?.provider === 'openlibrary'
        ? parts.resourceType === 'work'
          ? 'books'
          : 'book-editions'
        : parts?.provider === 'musicbrainz'
          ? parts.resourceType === 'release-group'
            ? 'albums'
            : parts.resourceType === 'release'
              ? 'album-editions'
              : 'recordings'
          : null
  const id = parts?.provider === 'tmdb' ? parts.id : mediaKey
  const links: Record<string, string> = {}
  if (collection) {
    links.self = catalogHref(c, `/${collection}/${encodeURIComponent(id)}`)
    if (collection === 'books' || collection === 'albums') links.editions = `${links.self}/editions`
    if (collection === 'series') links.seasons = `${links.self}/seasons`
    if (collection === 'movies' || collection === 'series') links.watchLinks = `${links.self}/watch-links`
  }
  if ('releaseMediaKey' in item)
    links.albumEdition = catalogHref(c, `/album-editions/${encodeURIComponent(item.releaseMediaKey)}`)
  return { ...item, mediaKey, links }
}

export function catalogHref(c: Context<AppEnv>, path: string) {
  return new URL(`/api/catalog${path}`, c.req.url).toString()
}

export function catalogPage<T extends CatalogSummary>(
  c: Context<AppEnv>,
  result: ResourcePage<T>,
  pageSize: number,
  exactTotals = true,
) {
  const items = result.results.map((item) => catalogItem(c, item))
  if (!exactTotals) return { items, pagination: { page: result.page, pageSize } }
  setPageLinks(c, { page: result.page, pageSize }, result.totalResults)
  return pageRepresentation(items, result.page, pageSize, result.totalResults, result.totalPages)
}
