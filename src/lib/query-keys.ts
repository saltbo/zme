import type { LibraryPageInput, MediaDiscoverInput, MediaKind } from '@shared/types'

export const queryKeys = {
  setupStatus: ['setup-status'] as const,
  library: {
    root: ['library'] as const,
    states: ['library', 'states'] as const,
    page: (input: LibraryPageInput) => ['library', 'page', input] as const,
    infinite: (input: Omit<LibraryPageInput, 'page'>) => ['library', 'infinite', input] as const,
  },
  librarySources: ['library-sources'] as const,
  downloaders: ['downloaders'] as const,
  downloadTasks: (status: string) => ['download-tasks', status] as const,
  indexers: ['indexers'] as const,
  mediaSources: ['media-sources'] as const,
  users: ['users'] as const,
  books: {
    trending: ['books', 'trending'] as const,
    search: (query: string) => ['books', 'search', query] as const,
    details: (mediaKey: string) => ['books', 'details', mediaKey] as const,
  },
  music: {
    popular: ['music', 'popular'] as const,
    search: (query: string) => ['music', 'search', query] as const,
    details: (mediaKey: string) => ['music', 'details', mediaKey] as const,
  },
  media: {
    trending: (language: string) => ['media', 'trending', language] as const,
    popular: (kind: MediaKind, language: string) => ['media', 'popular', kind, language] as const,
    discover: (input: Omit<MediaDiscoverInput, 'page'>) => ['media', 'discover', input] as const,
    genres: (kind: MediaKind, language: string) => ['media', 'genres', kind, language] as const,
    search: (query: string, language: string) => ['media', 'search', query, language] as const,
    details: (kind: MediaKind, id: number, language: string, watchRegion: string) =>
      ['media', 'details', kind, id, language, watchRegion] as const,
    season: (seriesId: number, seasonNumber: number, language: string) =>
      ['media', 'season', seriesId, seasonNumber, language] as const,
    watchClickouts: (kind: MediaKind, id: number, watchRegion: string) =>
      ['media', 'watch-clickouts', kind, id, watchRegion] as const,
    personCredits: (id: number, language: string) => ['media', 'person-credits', id, language] as const,
  },
}
