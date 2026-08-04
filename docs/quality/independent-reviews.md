# Independent release reviews

Two read-only reviews were run in separate contexts on 2026-08-04.

## Outcome review

Resolved findings:

- Media search now returns the stable `mediaKey` required by release-search creation.
- Agents discover credential-free download destinations through a separately scoped resource; the full-flow test consumes only prior API responses.
- Agent identity resolution no longer overwrites human OIDC display fields; the administrator allowlist is authoritative.
- Access-token and DPoP-proof failures have distinct credential error classes and challenges.
- Concurrent idempotent creates use atomic insert-or-load rather than leaking unique-constraint failures.
- Public signed music URLs carry API versioning, display/session responses are not cached, inputs/results are bounded, and public task errors are stable.
- The complete browser-session API is present in OpenAPI with operation-specific request/response schemas, Problem Details, idempotency, ETags, and precondition failures.
- Download tasks reconcile exact downstream progress, terminal result objects, and monotonic revisions.
- The upgrade fixture inventories every direct user-owned table and every transitive ownership edge without deleting or silently reassigning data.
- Connector-sync jobs now have per-user idempotency, crash-recovery leases, stable public errors, and a composite database ownership constraint.
- Connector-sync creation republishes the durable job identity after queue-delivery uncertainty, scheduled recovery republishes stranded queued rows, and active workers renew their owner-bound lease; real D1 tests cover the D1-to-Queue crash window, post-original-expiry duplicate claims, and stale-owner completion.
- Indexer, media-source, and downloader health checks now expose readable cached health resources separately from refresh requests.
- Slow health probes use database-level checked-at compare-and-set semantics, so an older completion cannot overwrite a newer health result for any of the three resource types.
- CI uses full history and the event's exact base SHA for a mechanically discovered, per-file changed-line coverage gate, fails zero-denominator discoveries, and reconciles native runner files plus individual test identities.

External acceptance still required after code review: real Realmroot preview discovery, registration, DPoP issuance, and the complete Agent workflow require controller-approved management access.

## Engineering review

Resolved findings:

- The D1 migration now protects affected child graphs in audit copies, restores them in dependency order, and tests the release-job/result/manual-task RESTRICT chain plus `foreign_key_check`.
- Agent calls preserve the human profile and local disabled policy; allowlist removal demotes prior administrators.
- JWT access tokens are validated in a distinct JOSE phase before the standards-library DPoP phase, permitting correct challenge classification.
- Required local URLs match Vite port 7171; exact callback/logout paths and trailing-slash issuers are tested.
- Core TMDB/Prowlarr calls have timeouts and downstream response bodies are not persisted/exposed as task errors.
- Release-search and connector-sync workers use owner-bound leases with recovery tests; stale workers cannot write terminal state.
- Connector-sync workers continuously renew live leases, while durable queued rows are safely republished after queue-delivery uncertainty and deduplicated by atomic claim.
- Downloader, indexer, and media-source health updates enforce monotonic probe completion in D1 rather than relying on process-local ordering.
- Browser OpenAPI route inventory, health resources, idempotency, conditional writes, and uniform errors are contract-tested.
- Migration fixtures cover the complete ownership graph and connector-sync legacy backfill, including composite foreign-key validation.
- Native report reconciliation checks every file and test identity, while changed production inventory is mechanically mapped to Unit/API/Web profiles; zero executable-line denominators fail and TMDB timeout behavior is explicitly covered.

External acceptance still required after the final independent re-review: the real Realmroot preview flow must pass before the change can leave Draft or be released. Both independent reviewers classified this as an external acceptance gate rather than a code blocker, so a Draft PR may carry the implementation and evidence while the external failure remains visible.

## Post-review external acceptance attempt

The isolated Agent enrolled successfully and discovered the live Realmroot inventory and the exact personal Account authority Resource. Two least-privilege management access requests contained the expected `realmroot_authority` authorization-details array and only `applications:read`, `applications:write`, `resource-servers:read`, and `resource-servers:write`. The Realmroot approval page rejected both its persistent and one-target-token choices with `Invalid input: expected array, received null`; request `accessreq_1920d28cc86341e483b3ce68d0b1a7cd` remained pending and no authorization or credential was issued. ZME did not bypass controller approval, borrow the browser session, or widen authority. Registration, DPoP issuance, and the live business flow remain blocking conditions for Ready-for-review and release, but not for publishing a Draft PR that reports the blocker.
