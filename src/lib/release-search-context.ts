import type { ReleaseMatchCriteria, ResourceDownloadSearchInput } from '@shared/indexer-search'
import { uniqueStrings } from '@shared/indexer-search'
import type { BookDetails, DownloadSearchTarget, MediaDetails } from '@shared/types'
import type { ReleaseSearchMedia } from '@/components/release-search-dialog'

export interface MediaReleaseSearchInput extends ReleaseMatchCriteria {
  label: string
}

export interface ResourceReleaseSearchInput extends ResourceDownloadSearchInput {
  item: ReleaseSearchMedia
  title: string
  aliases: string[]
  creators: string[]
  year: string | null
  formats: string[]
  narrator: string | null
}

export function getMediaReleaseSearchInput(media: MediaDetails): MediaReleaseSearchInput {
  const title = media.title
  const aliases = uniqueStrings([media.originalTitle, ...media.aliases])
  const query = [title, media.releaseYear].filter(Boolean).join(' ')
  const tmdbId = Number(media.ids.tmdb)
  const tvdbId = Number(media.ids.tvdb)
  const imdbId = normalizeImdbId(media.ids.imdb)
  const hasTmdbId = Number.isFinite(tmdbId) && tmdbId > 0
  const hasTvdbId = Number.isFinite(tvdbId) && tvdbId > 0
  const label =
    media.kind === 'tv' && hasTvdbId
      ? `TVDB ${tvdbId}`
      : imdbId
        ? `IMDb ${imdbId}`
        : hasTmdbId
          ? `TMDB ${tmdbId}`
          : query

  return {
    query,
    title,
    aliases,
    year: media.releaseYear,
    kind: media.kind,
    tmdbId: hasTmdbId ? tmdbId : undefined,
    tvdbId: hasTvdbId ? tvdbId : undefined,
    imdbId,
    label,
  }
}

export function getBookReleaseSearchInput(
  book: BookDetails,
  target: Extract<DownloadSearchTarget, 'ebook' | 'audiobook'>,
): ResourceReleaseSearchInput {
  const targetFormat = target === 'ebook' ? 'ebook' : 'audiobook'
  const formats = target === 'ebook' ? ['ebook', 'epub', 'mobi', 'azw3', 'pdf'] : ['audiobook', 'm4b', 'm4a', 'mp3']
  const year = book.firstPublishYear ? String(book.firstPublishYear) : null
  const query = [book.title, book.authors[0], year, targetFormat].filter(Boolean).join(' ')

  return {
    target,
    query,
    item: toBookReleaseMedia(book, target),
    title: book.title,
    aliases: uniqueStrings(book.aliases),
    creators: uniqueStrings(book.authors),
    year,
    formats,
    narrator: null,
  }
}

function toBookReleaseMedia(book: BookDetails, target: 'ebook' | 'audiobook'): ReleaseSearchMedia {
  return {
    id: 0,
    kind: 'movie',
    title: book.title,
    originalTitle: book.title,
    overview: book.description ?? '',
    posterUrl: book.coverUrl,
    backdropUrl: null,
    releaseYear: book.firstPublishYear ? String(book.firstPublishYear) : null,
    rating: null,
    genres: book.languages,
    downloadCategory: `zme:${target}`,
    downloadTags: [`mediaKey=${book.mediaKey}`, 'kind=book', `target=${target}`],
  }
}

function normalizeImdbId(value: string | null): string | undefined {
  if (!value) return undefined
  return /^tt\d+$/i.test(value) ? value.toLowerCase() : undefined
}
