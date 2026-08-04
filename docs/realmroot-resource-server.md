# Realmroot Native Resource Server

When `OIDC_ISSUER` and `REALMROOT_ISSUER` are the same Realmroot issuer, ZME serves as a Realmroot Native Resource Server at the exact `REALMROOT_RESOURCE_URL`.

## Discovery and registration

Every response from the resource server publishes RFC 8631 discovery:

```http
Link: <https://zme.example/api/openapi.json>; rel="service-desc"; type="application/openapi+json"
```

Register the exact resource URL, not just the site origin. Give Realmroot the service-description URL. The OpenAPI security requirements are the machine-readable scope source:

- `media:read`
- `release-search-jobs:write`
- `release-search-jobs:read`
- `download-destinations:read`
- `download-tasks:write`
- `download-tasks:read`

Do not register scopes for media-source, indexer, downloader, connector, credential, OIDC, or site administration. Those human-only operations are outside the Agent contract.

## Authorization semantics

Realmroot must issue an `at+jwt` resource token with audience equal to the exact resource URL and bind it to the Agent key with `cnf.jkt`. Each request uses `Authorization: DPoP <token>` plus a fresh `DPoP` proof. ZME verifies token and proof signatures, issuer, audience, expiration/issued-at, asymmetric algorithm allowlist, thumbprint binding, method, exact URL, identifier, access-token hash, and replay state. There is no Bearer fallback.

The token `sub` resolves to the same local projection as the human OIDC session. The token `act` remains the actual Agent audit actor. Effective permission is token scope ∩ local policy ∩ resource ownership ∩ Agent-safe route allowlist.

## Least-privilege Agent acceptance flow

1. Discover Realmroot using its published discovery interface.
2. Discover ZME as a Resource Server and follow its `service-desc` link.
3. Read the OpenAPI and request only the scopes needed for the next step.
4. `GET /api/media?query=...` with `media:read`; select a movie or series.
5. `POST /api/release-search-jobs` with `release-search-jobs:write`, an `Idempotency-Key`, the media key/title, query, optional search type, and categories.
6. Read the job and `/release-search-jobs/{id}/results` with `release-search-jobs:read`. Candidates include title, source, bytes, source/resolution/HDR quality, video/audio encoding, seeders, leechers, protocol, and publish time when the indexer supplies them.
7. `GET /api/download-destinations` with `download-destinations:read`; choose an enabled destination from its credential-free summary. ZME advertises only destinations with exact per-task status lookup, so every Agent-created task supports the complete status lifecycle. The current native adapter is ZPan; other browser-configurable downloaders are intentionally excluded until they implement that capability.
8. Select a result and `POST /api/download-tasks` with `download-tasks:write`, the chosen destination ID, and a new `Idempotency-Key`.
9. Read `/download-tasks/{id}` with `download-tasks:read`. Report downstream status and progress while `submitted` or `running`; on `completed`, report the safe result object, name, target folder, and final byte counts. `failed` and `canceled` include only a safe error when present.

All result, job, and task lookups are scoped to the represented user. Reusing an idempotency key with different content returns a conflict. Replaying a proof, changing its method/URL, using the wrong audience, omitting a required scope, or crossing ownership boundaries is rejected.

## Preview acceptance and retry

The 2026-08-04 isolated preview proved Cloudflare dispatch, empty-database migration, exact service discovery, and the published 81-operation OpenAPI. Live Realmroot enrollment and Realmroot inventory discovery also succeeded. The subsequent controller decision failed inside Realmroot for both persistent and one-target-token grants with `Invalid input: expected array, received null`, although Realmroot readback contained the expected Account authority array and exact management scopes. No grant or credential was issued, and ZME did not bypass the approval boundary.

After Realmroot corrects that decision failure:

1. Start with a fresh isolated Agent identity and rediscover the `realmroot` server and exact Account or Organization authority Resource.
2. Request only `applications:read`, `applications:write`, `resource-servers:read`, and `resource-servers:write`; have the controller approve one target token.
3. Read the collections before mutation, then register the public PKCE browser client and the exact ZME `/api` Resource Server. Read both resources back and configure the returned public client ID in the preview.
4. Sign in as the intended human administrator, read that projection's exact issuer and subject from the dedicated preview database, configure the explicit administrator allowlist, redeploy, and verify the session lifecycle.
5. Rediscover ZME through Realmroot, follow `service-desc`, request only the six scopes listed above, and execute the complete media, release-search, destination, download, and task-status flow.

The Draft must not become ready and the release must not proceed until those readbacks and target calls succeed.
