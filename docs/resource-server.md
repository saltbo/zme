# OIDC DPoP Resource Server

ZME is a standards-based Resource Server at `${PUBLIC_APP_ORIGIN}/api`. It uses the same configured `OIDC_ISSUER` for browser identity and DPoP-bound Agent access, so an exact `(iss, sub)` pair resolves to one local authorization projection.

## Discovery and scopes

Every Resource Server response publishes RFC 8631 discovery:

```http
Link: <https://zme.example/api/openapi.json>; rel="service-desc"; type="application/openapi+json"
```

The OpenAPI security requirements are the machine-readable scope source:

- `media:read`
- `release-search-jobs:write`
- `release-search-jobs:read`
- `download-destinations:read`
- `download-tasks:write`
- `download-tasks:read`

Credential, connector login, OIDC, media-source, indexer, downloader, and site-administration operations are browser-session-only and never appear as Agent scopes.

## Authorization semantics

The issuer must provide an `at+jwt` access token whose audience is the exact Resource Server URL and whose `cnf.jkt` binds it to the caller key. Each request uses `Authorization: DPoP <token>` plus a fresh `DPoP` proof. ZME verifies token and proof signatures, asymmetric algorithms, issuer, audience, expiration and issued-at claims, thumbprint binding, method, exact URL, proof identifier, access-token hash, and replay state. Bearer fallback is rejected.

The token `sub` identifies the represented local user. The standard `act.sub` claim identifies the actual Agent and is retained for audit. Effective permission is token scope ∩ local policy ∩ resource ownership ∩ Agent-safe route allowlist; a local administrator role never expands token scope.

## Least-privilege acceptance flow

1. Discover the Resource Server and follow its `service-desc` link.
2. Read the OpenAPI and request only the scopes needed for the next operation.
3. `GET /api/media?query=...` with `media:read`; select a movie or series.
4. `POST /api/release-search-jobs` with `release-search-jobs:write`, an `Idempotency-Key`, the media key/title, query, optional search type, and categories.
5. Read the job and `/release-search-jobs/{id}/results` with `release-search-jobs:read`. Candidates include title, source, bytes, source/resolution/HDR quality, video/audio encoding, seeders, leechers, protocol, and publish time when supplied by the indexer.
6. `GET /api/download-destinations` with `download-destinations:read`; choose an enabled credential-free destination summary.
7. Select a result and `POST /api/download-tasks` with `download-tasks:write`, the chosen destination ID, and a new `Idempotency-Key`.
8. Read `/download-tasks/{id}` with `download-tasks:read`. Report downstream status and progress while submitted or running; on completion, report the safe result object and final byte counts.

All job, result, destination, and task reads are scoped to the represented user. Reusing an idempotency key with different content returns a conflict. Replaying a proof, changing its method or URL, using the wrong audience, omitting a scope, or crossing an ownership boundary is rejected with a DPoP challenge or Problem Details response.

## Deployment acceptance

Use an isolated preview with dedicated storage and queues. Apply all migrations to an empty preview database, fetch the exact Resource Server URL and linked OpenAPI, then obtain a least-privilege DPoP token from the configured provider and execute the complete flow above. Do not promote a release until discovery, token validation, ownership boundaries, downloader submission, and terminal task reconciliation all pass against that preview.
