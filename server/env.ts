export interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>
  }
  TMDB_API_KEY?: string
  PROWLARR_URL?: string
  PROWLARR_API_KEY?: string
  ZPAN_BASE_URL?: string
}
