# External OIDC deployment

ZME is an OIDC relying party, not an identity provider. A deployment must configure exactly one provider and must fail startup/request initialization when security-critical configuration is absent or inconsistent.

## Required variables

| Variable | Meaning |
| --- | --- |
| `PUBLIC_APP_ORIGIN` | Exact public origin, with no path |
| `OIDC_ISSUER` | Exact issuer from discovery |
| `OIDC_CLIENT_ID` | Registered client identifier |
| `OIDC_ADMIN_SUBJECTS` | Nonempty comma-separated exact `sub` allowlist for the configured issuer |
| `CONNECTOR_CREDENTIALS_SECRET` | Independent secret for third-party connector state |

ZME derives the exact callback URI (`${PUBLIC_APP_ORIGIN}/auth/callback`), post-logout URI (`${PUBLIC_APP_ORIGIN}/login`), and resource audience (`${PUBLIC_APP_ORIGIN}/api`). Register the first two at the provider; do not configure them again in ZME.

Set `OIDC_CLIENT_SECRET` as a Worker secret only for confidential clients. Its presence defaults token endpoint authentication to `client_secret_basic`; set optional `OIDC_TOKEN_ENDPOINT_AUTH_METHOD=client_secret_post` only when that is the registered method. Public clients omit both values and use `none`. `OIDC_LEGACY_BINDINGS_JSON` is optional and should exist only during a reviewed upgrade. ZME accepts only its built-in asymmetric JOSE algorithm allowlist and validates provider metadata, token signatures, issuer, audience, expiry, and nonce; algorithms are not deployment configuration.

This breaking draft changed `OIDC_ADMIN_SUBJECTS` from repeated `issuer|subject` values to `subject` values because one deployment already has exactly one issuer. Convert any preview configuration before redeploying; the old format intentionally does not match a subject.

```bash
wrangler secret put OIDC_CLIENT_SECRET
wrangler secret put CONNECTOR_CREDENTIALS_SECRET
pnpm cf-typegen
pnpm db:migrate:remote
pnpm deploy
```

Use environment-specific Wrangler configuration or dashboard variables for non-secret values; do not commit production subjects or client secrets. HTTPS is mandatory except for explicit localhost/127.0.0.1 development. The derived resource URL, redirect URI, logout URI, and app origin are exact values, not prefixes or wildcard allowlists.

The committed Worker configuration enables Cloudflare's `global_fetch_strictly_public` compatibility flag. Keep it enabled when the OIDC Provider is another publicly routed Worker on the same Cloudflare zone; without it, discovery, JWKS, token, or user-info requests can fail with Cloudflare error 1042.

## Operational checks

1. Fetch provider discovery and confirm the returned `issuer` is exact, PKCE includes `S256`, and authorization/token/JWKS endpoints use HTTPS.
2. Fetch `${PUBLIC_APP_ORIGIN}/api/openapi.json` and confirm `Link: <.../openapi.json>; rel="service-desc"; type="application/openapi+json"` is returned from the exact resource server URL.
3. Complete login, reload, and logout in a real browser. The application cookie must be `__Host-zme_session`, Secure, HttpOnly, SameSite=Lax, and Path `/`.
4. Verify that registration, password recovery, password change, and local account administration are absent.
5. Watch structured request logs for request IDs and error classes only. Tokens, secrets, raw claims, email, and DPoP proofs must not appear.
