import type {
  MediaDetails,
  MediaDiscoverInput,
  MediaDiscoverPage,
  MediaGenre,
  MediaKind,
  MediaPersonCredits,
  MediaSearchItem,
  MediaSeasonDetails,
} from '@shared/types'
import type { Deps } from './deps'
import { getActiveTmdbSource } from './media-sources'

export async function searchMedia(deps: Deps, query: string, language?: string): Promise<MediaSearchItem[]> {
  const source = await getActiveTmdbSource(deps, language)
  return deps.mediaProvider.search(source, query)
}

export async function getTrendingMedia(deps: Deps, language?: string): Promise<MediaSearchItem[]> {
  const source = await getActiveTmdbSource(deps, language)
  return deps.mediaProvider.trending(source)
}

export async function getPopularMedia(deps: Deps, kind: MediaKind, language?: string): Promise<MediaSearchItem[]> {
  const source = await getActiveTmdbSource(deps, language)
  return deps.mediaProvider.popular(source, kind)
}

export async function discoverMedia(
  deps: Deps,
  input: Omit<MediaDiscoverInput, 'language'> & { language?: string },
): Promise<MediaDiscoverPage> {
  const source = await getActiveTmdbSource(deps, input.language)
  return deps.mediaProvider.discover(source, input)
}

export async function listMediaGenres(deps: Deps, kind: MediaKind, language?: string): Promise<MediaGenre[]> {
  const source = await getActiveTmdbSource(deps, language)
  return deps.mediaProvider.genres(source, kind)
}

export async function getMediaDetails(
  deps: Deps,
  kind: MediaKind,
  id: number,
  watchRegion: string,
  language?: string,
): Promise<MediaDetails> {
  const source = await getActiveTmdbSource(deps, language)
  return deps.mediaProvider.details(source, kind, id, watchRegion)
}

export async function getSeasonDetails(
  deps: Deps,
  id: number,
  seasonNumber: number,
  language?: string,
): Promise<MediaSeasonDetails> {
  const source = await getActiveTmdbSource(deps, language)
  return deps.mediaProvider.season(source, id, seasonNumber)
}

export async function getPersonCredits(deps: Deps, id: number, language?: string): Promise<MediaPersonCredits> {
  const source = await getActiveTmdbSource(deps, language)
  return deps.mediaProvider.personCredits(source, id)
}

export async function getWatchClickouts(
  deps: Deps,
  kind: MediaKind,
  id: number,
  watchRegion: string,
): Promise<Record<string, string>> {
  return deps.mediaProvider.watchClickouts(kind, id, watchRegion)
}
