// Bindings + normal deployment vars are generated from wrangler.toml and
// .dev.vars.example. These three values exist only for confidential clients or
// a reviewed identity migration, so they remain optional at the runtime edge.
export type Env = Cloudflare.Env & {
  OIDC_CLIENT_SECRET?: string
  OIDC_TOKEN_ENDPOINT_AUTH_METHOD?: string
  OIDC_LEGACY_BINDINGS_JSON?: string
}
