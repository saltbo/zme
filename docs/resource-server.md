# OIDC DPoP Resource Server

ZME is a standards-based Resource Server at `${PUBLIC_APP_ORIGIN}/api`. It uses the same configured `OIDC_ISSUER` for browser identity and DPoP-bound Agent access, so an exact `(iss, sub)` pair resolves to one local authorization projection.

## Discovery and scopes

The Resource Server publishes RFC 9728 Protected Resource Metadata at:

```http
GET https://zme.example/.well-known/oauth-protected-resource/api
```

Its `resource` is the exact `https://zme.example/api` audience,
`authorization_servers` identifies the configured external issuer, and
`scopes_supported` is the authoritative Resource Server scope catalog. The
metadata also declares that DPoP-bound access tokens are required and lists the
accepted DPoP proof algorithms.

Every Resource Server response publishes RFC 8631 discovery:

```http
Link: <https://zme.example/api/openapi.json>; rel="service-desc"; type="application/openapi+json"
```

The current scope catalog is:

- `media:read`
- `release-candidates:read`
- `downloaders:read`
- `downloads:read`
- `downloads:write`
- `downloads:manage`

OpenAPI operation security requirements map each Agent-safe HTTP operation to
one catalog scope. The catalog is declared independently, so a supported scope
can remain discoverable even when no current OpenAPI operation uses it.
Credential, connector login, OIDC, media-source, indexer, downloader
configuration, and site-administration operations are browser-session-only and
never appear as Agent scopes.

## Authorization semantics

The issuer must provide an `at+jwt` access token whose audience is the exact Resource Server URL and whose `cnf.jkt` binds it to the caller key. Each request uses `Authorization: DPoP <token>` plus a fresh `DPoP` proof. ZME verifies token and proof signatures, asymmetric algorithms, issuer, audience, expiration and issued-at claims, thumbprint binding, method, exact URL, proof identifier, access-token hash, and replay state. Bearer fallback is rejected.

The token `sub` identifies the represented local user. The standard `act.sub` claim identifies the actual Agent and is retained for audit. Effective permission is token scope ∩ local policy ∩ resource ownership ∩ Agent-safe route allowlist; a local administrator role never expands token scope.

## Least-privilege acceptance flow

1. Derive and read the RFC 9728 Protected Resource Metadata from the Resource Server URL.
2. Read `authorization_servers` to discover the external provider and `scopes_supported` to learn the complete Resource Server scope catalog.
3. Follow the Resource Server's `service-desc` link and read the OpenAPI to request only the scopes needed for the next operation.
4. `GET /api/media?query=...` with `media:read`; select a movie or series.
5. `GET /api/release-candidates?mediaKey=...&query=...` with `release-candidates:read`; select a release candidate.
6. `GET /api/downloaders` with `downloaders:read`; choose an enabled credential-free downloader summary.
7. `POST /api/downloads` with `downloads:write`, a new `Idempotency-Key`, the opaque candidate reference, and downloader ID.
8. Read `/api/downloads/{id}` with `downloads:read`. Use `downloads:manage` for the owned download's suspension, cancellation, or deletion resources.

All downloader and download reads are scoped to the represented user. Reusing an idempotency key with different content returns a conflict. Replaying a proof, changing its method or URL, using the wrong audience, omitting a scope, or crossing an ownership boundary is rejected with a DPoP challenge or Problem Details response.

## Deployment acceptance

Use an isolated preview with dedicated storage and queues. Apply all migrations to an empty preview database, fetch the exact Resource Server URL and linked OpenAPI, then obtain a least-privilege DPoP token from the configured provider and execute the complete flow above. Do not promote a release until discovery, token validation, ownership boundaries, downloader submission, and terminal task reconciliation all pass against that preview.
