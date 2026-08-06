# ADR 0001: External OIDC identity and a versioned resource API

- Status: accepted
- Date: 2026-08-04
- Decision owners: ZME maintainers
- Release impact: breaking (`API-Version: 2026-08-04`)

## Outcome and release baseline

ZME must authenticate people only through one deployment-configured, standards-compliant OIDC provider and must never become an account, password, registration, or identity-provider service. A DPoP client representing the same `iss`/`sub` must resolve to the same local ZME authorization projection and complete media search, release selection, and downloader submission with least-privilege access.

The release baseline is the public `1.0.0` application and its unversioned browser API. That API exposed provider/action-shaped routes and a local credential account system. The identity semantics, database schema, session format, and Agent-facing API all change, so a silent compatibility layer would preserve unsafe identity behavior and two conflicting API models. This release deliberately rejects the old routes and requires `API-Version: 2026-08-04` on API calls.

Observable acceptance criteria are:

1. an external Authorization Code + PKCE S256 login establishes an opaque, secure local application session;
2. only `(issuer, subject)` resolves identity, while name and email remain mutable display data;
3. existing owned records survive an explicitly mapped upgrade;
4. a DPoP-bound token can use only RFC 9728-declared scopes, only the subset required by each OpenAPI operation, and only resources owned by its represented subject;
5. the complete media → release-search job → candidate → download-task lifecycle is represented as resources and tested through HTTP.

## Decision

Use `oauth4webapi@3.8.6` for OIDC discovery, authorization response validation, token exchange, ID-token validation, JWT access-token validation, DPoP proof validation, and JWKS caching/refresh. Use `jose@6.2.8` only for supported JWT header/claim decoding and RFC 7638 thumbprints after protocol validation. Both versions are exact pins. These libraries are runtime-neutral Web API implementations suitable for Cloudflare Workers and avoid Node-only adapters or hand-written cryptography.

Browser login uses discovery, an exact redirect URI, one-time hashed `state`, `nonce`, a high-entropy verifier, and PKCE S256. ID tokens must pass issuer, audience, expiry, signature, nonce, and an asymmetric algorithm allowlist. Discovery and JWKS are cached; an unknown signing key causes a standards-library refresh so provider key rotation works. Login transaction state is single-use and short-lived.

ZME stores an opaque session token only in a `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` `__Host-` cookie. Only its hash is stored. Logout revokes the local session and uses provider end-session metadata when available. Tokens, secrets, code verifiers, raw claims, and connector credentials are never logged.

The local `users` row is an authorization projection. Its identity key is the unique nullable pair `(issuer, subject)` during migration and the pair is required before the row may authenticate. `oidc_email`, name, and image may change on every login. Credential-era email-verification and ban fields are removed; the protected pre-migration backup and reviewed binding artifact provide audit and rollback evidence. Email is never an identity link. Initial administrator status comes solely from the configured subject allowlist for the single configured issuer.

The Resource Server publishes RFC 9728 Protected Resource Metadata at `/.well-known/oauth-protected-resource/api`. Its `scopes_supported` is the authoritative Resource Server scope catalog, while `authorization_servers` points clients to the external provider. The complete HTTP API is described by `/api/openapi.json`; each Agent-safe operation declares the exact catalog scope it requires. The scope catalog and operation policies share one authorization module, and OpenAPI plus runtime authorization consume the same operation policies. Browser-session operations use session-only security and never advertise Agent scopes.

## DPoP security model

Agent access accepts only `Authorization: DPoP`; Bearer is rejected. The access token must be `typ=at+jwt`, signed by an allowed asymmetric provider key, and valid for issuer, exact resource audience, expiry and issued-at. It must carry `cnf.jkt`. The proof must validate its signature/thumbprint, `htm`, exact `htu`, `jti`, `iat`, and `ath`. A proof identifier plus issuer and thumbprint is stored until the replay window expires. Errors return an appropriate `WWW-Authenticate: DPoP` challenge.

The token's `sub` identifies the represented human projection; `act` identifies the actual Agent and is retained on the request principal for audit. Effective permission is the intersection of token scope, local role/policy, resource ownership, and the hard Agent-safe route allowlist. A local administrator role does not add token scopes. Credentials, connector login, OIDC configuration, media-source, indexer, downloader, and site-management operations are not Agent-accessible.

## Threats and controls

| Threat | Control |
| --- | --- |
| Login CSRF/code injection | one-time hashed state, nonce, PKCE S256, exact redirect URI |
| Token substitution | issuer, audience, nonce, expiry, signature, and algorithm validation |
| JWKS compromise/staleness | HTTPS outside explicit localhost, bounded fetches, cache plus unknown-key refresh |
| Session theft/fixation | random opaque token, hash at rest, `__Host-` cookie, rotation on login, expiry and logout revocation |
| Identity takeover by email | identity only by exact `iss`/`sub`; explicit legacy binding |
| First-user privilege escalation | configured administrator subject allowlist; no database-empty shortcut |
| DPoP downgrade/replay | no Bearer fallback, `cnf.jkt`, `ath`, `htm`/`htu`, persisted `jti` replay rejection |
| Agent privilege expansion | OpenAPI scope allowlist intersected with local ownership/policy; high-risk surfaces denied |
| Cross-user data access | every job/result/task repository lookup includes local user ownership |
| Duplicate mutations | mandatory idempotency key scoped to user; payload hash conflict on reuse |

## Consequences

Deployments must register ZME as an OIDC client and identify at least one administrator subject before starting. Existing users cannot sign in until an operator supplies explicit bindings. The API and authentication change require coordinated deployment and migration, but the database migration preserves user IDs and owned records so rollback remains possible from a pre-migration backup. Operational procedures are in [OIDC migration](../oidc-migration.md), [deployment](../oidc-deployment.md), and [Resource Server](../resource-server.md).
