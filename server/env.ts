import type { D1Database } from '@cloudflare/workers-types'

export interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>
  }
  DB: D1Database
  TMDB_API_KEY?: string
  TMDB_LANGUAGE?: string
  PROWLARR_URL?: string
  PROWLARR_API_KEY?: string
  ZPAN_BASE_URL?: string
}
