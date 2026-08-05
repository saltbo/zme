# OIDC and Resource API verification inventory

This release inventory maps each new observable contract to the native runner that proves it. Stable scenario IDs come from `spec/auth.feature`; public operation IDs come from the production OpenAPI generator.

| Contract | Required profile | Executable proof |
| --- | --- | --- |
| `auth/login-redirect`, `auth/sign-in`, `auth/session-persists` | critical browser journey | `e2e/oidc-auth.spec.ts` |
| `auth/external-only` | frontend behavior | `e2e/oidc-auth.spec.ts` |
| `auth/reject-invalid-callback` | protocol adapter and API integration | `server/adapters/gateways/oidc.test.ts`, `server/api-tests/identity-flow.test.ts` |
| `auth/api-requires-session`, `auth/admin-only` | API integration | `server/api-tests/api.test.ts` |
| `auth/configured-admin`, `auth/no-email-linking` | usecase and D1 integration | `server/usecases/identity.test.ts`, `server/api-tests/identity-flow.test.ts` |
| OIDC discovery, PKCE S256, state, nonce, token validation, JWKS rotation | protocol adapter | `server/adapters/gateways/oidc.test.ts` |
| Empty database migration | D1 migration | every API test via `server/api-tests/apply-migrations.ts` |
| Representative credential-era upgrade and every ownership edge | D1 migration | `server/api-tests/identity-migration.test.ts` |
| DPoP token/proof binding and failure matrix | protocol adapter | `server/adapters/gateways/dpop-token.test.ts` |
| DPoP replay, scope, ownership, high-risk denial, challenge headers | API integration | `server/api-tests/dpop-resource.test.ts` |
| `listMedia`, `createReleaseSearchJob`, `listReleaseSearchResults`, `listDownloadDestinations`, `createDownloadTask`, `getDownloadTask` including exact ZPan lookup and final downloader progress/result | full resource workflow | `server/api-tests/dpop-resource.test.ts`, `server/adapters/gateways/downloaders/zpan.test.ts` |
| leased release and connector-sync recovery, queued-job republishing after the D1-to-Queue crash window, live lease renewal, idempotent connector creation, database ownership constraints, partial-result invisibility/cleanup, monotonic health writes, and monotonic revisioned download state | real D1 concurrency | `server/api-tests/resource-concurrency.test.ts`, `server/api-tests/api.test.ts` |
| every production `/api` route, request/response/query/path/media semantics, unique operation IDs, scopes, session-only high-risk operations | contract | `server/http/openapi.test.ts`, Redocly 2.44.1 `recommended-strict` lint, and reviewed semantic signature |
| exact deployed `/api` dispatch and same-zone public OIDC provider compatibility | deployment configuration and live preview | `scripts/verify-quality-inventory.ts`, `wrangler.toml`, isolated Cloudflare preview |
| every Gherkin scenario/native proof pair, evidence path, skip/focus audit, and native runner result/file reconciliation | inventory | `pnpm quality:inventory`, `pnpm test:ci`, `pnpm e2e:ci` |

Native evidence on 2026-08-04: Vitest 57 files/391 tests passed and its native JSON report reconciled every file and uniquely identified assertion; unit coverage 39 files/297 tests passed at 59.20% statements. Against the exact release base, the task gate mechanically discovered 18 changed Unit-owned production files, rejected zero-denominator discoveries, enforced at least 90% changed-line coverage on each file, and covered 599/617 changed executable lines in aggregate (97.08%). Playwright Chromium 7/7 passed with retries disabled and its native JSON report reconciled every uniquely identified test/result across all three E2E files. Redocly CLI 2.44.1 `recommended-strict` validated the runtime-generated OpenAPI without warnings or errors; the complete semantic contract matched all 81 reviewed operations and all component schemas/security definitions. The quality inventory reconciled 18/18 Gherkin IDs across 60 native test files and mechanically classified every changed production TypeScript/SQL file into its required Unit, API, or Web verification profile. No test is failed, pending, skipped, focused, or flaky.

An isolated Cloudflare acceptance preview uses Worker `zme-oidc-preview`, a dedicated D1 database, and a dedicated Queue rather than production state. All 27 migrations applied cleanly to the empty preview database. The exact `https://zme-oidc-preview.saltbo.workers.dev/api` Resource Server URL returns canonical discovery metadata and an RFC 8631 `service-desc` Link; its linked OpenAPI contains all 81 reviewed operations and only the six documented Agent scopes.

Promotion requires a fresh provider-issued, least-privilege DPoP token against the isolated preview and successful completion of the workflow in `docs/resource-server.md`. The Draft remains blocked from release until that external acceptance evidence is recorded.
