import type { MediaKind } from '@shared/types'

export const queryKeys = {
  setupStatus: ['setup-status'] as const,
  favorites: ['favorites'] as const,
  downloaders: ['downloaders'] as const,
  indexers: ['indexers'] as const,
  mediaSources: ['media-sources'] as const,
  users: ['users'] as const,
  media: {
    trending: (language: string) => ['media', 'trending', language] as const,
    popular: (kind: MediaKind, language: string) => ['media', 'popular', kind, language] as const,
    search: (query: string, language: string) => ['media', 'search', query, language] as const,
    details: (kind: MediaKind, id: number, language: string) => ['media', 'details', kind, id, language] as const,
  },
}
