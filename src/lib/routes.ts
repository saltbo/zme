import type { MediaKind } from '@shared/types'

export interface RouteMedia {
  kind: MediaKind
  id: number
}

export function getRouteMedia(pathname: string): RouteMedia | undefined {
  const movieMatch = pathname.match(/^\/movies\/(\d+)$/)
  if (movieMatch) {
    return { kind: 'movie', id: Number(movieMatch[1]) }
  }

  const seriesMatch = pathname.match(/^\/series\/(\d+)$/)
  if (seriesMatch) {
    return { kind: 'tv', id: Number(seriesMatch[1]) }
  }

  return undefined
}
