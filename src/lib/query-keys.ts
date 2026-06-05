import type { MediaDiscoverInput, MediaKind } from '@shared/types'

export const queryKeys = {
  setupStatus: ['setup-status'] as const,
  favorites: ['favorites'] as const,
  downloaders: ['downloaders'] as const,
  downloadTasks: (status: string) => ['download-tasks', status] as const,
  indexers: ['indexers'] as const,
  mediaSources: ['media-sources'] as const,
  users: ['users'] as const,
  media: {
    trending: (language: string) => ['media', 'trending', language] as const,
    popular: (kind: MediaKind, language: string) => ['media', 'popular', kind, language] as const,
    discover: (input: Omit<MediaDiscoverInput, 'page'>) => ['media', 'discover', input] as const,
    genres: (kind: MediaKind, language: string) => ['media', 'genres', kind, language] as const,
    search: (query: string, language: string) => ['media', 'search', query, language] as const,
    details: (kind: MediaKind, id: number, language: string, watchRegion: string) =>
      ['media', 'details', kind, id, language, watchRegion] as const,
    watchClickouts: (kind: MediaKind, id: number, watchRegion: string) =>
      ['media', 'watch-clickouts', kind, id, watchRegion] as const,
    personCredits: (id: number, language: string) => ['media', 'person-credits', id, language] as const,
  },
}
