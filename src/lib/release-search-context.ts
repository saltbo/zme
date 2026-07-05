import type { ReleaseMatchCriteria, ResourceDownloadSearchInput } from '@shared/indexer-search'
import { uniqueStrings } from '@shared/indexer-search'
import type { BookDetails, DownloadSearchTarget, MediaDetails, MusicAlbumDetails } from '@shared/types'
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

export function getMusicReleaseSearchInput(album: MusicAlbumDetails): ResourceReleaseSearchInput {
  const creators = getMusicCreators(album)
  const formats = uniqueStrings([...album.formats, album.primaryType, ...album.secondaryTypes, 'flac', 'mp3'])
  const aliases = uniqueStrings([
    ...album.aliases.map((alias) => alias.name),
    ...album.releases.map((release) => release.title),
  ])
  const query = [album.title, creators[0], album.releaseYear, formats[0]].filter(Boolean).join(' ')

  return {
    target: 'music',
    query,
    item: toMusicReleaseMedia(album),
    title: album.title,
    aliases,
    creators,
    year: album.releaseYear,
    formats,
    narrator: null,
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

function toMusicReleaseMedia(album: MusicAlbumDetails): ReleaseSearchMedia {
  return {
    id: 0,
    kind: 'movie',
    title: album.title,
    originalTitle: album.title,
    overview: album.disambiguation ?? '',
    posterUrl: album.coverArt.frontUrl,
    backdropUrl: null,
    releaseYear: album.releaseYear,
    rating: null,
    genres: album.secondaryTypes,
    downloadCategory: 'zme:music',
    downloadTags: [`mediaKey=${album.mediaKey}`, 'kind=music'],
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

function getMusicCreators(album: MusicAlbumDetails) {
  return uniqueStrings([...album.artists.map((artist) => artist.name), album.artist])
}

function normalizeImdbId(value: string | null): string | undefined {
  if (!value) return undefined
  return /^tt\d+$/i.test(value) ? value.toLowerCase() : undefined
}
