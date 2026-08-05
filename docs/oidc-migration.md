# Migrating an existing deployment to external OIDC

This is a breaking, operator-controlled identity migration. Do not deploy the new Worker before the database backup, identity inventory, and provider client registration are complete.

## 1. Back up and inventory

Export the production D1 database and retain the export under the deployment's normal protected backup policy. Record the current release and migration journal. On the old database, export user IDs and ownership counts for every user-owned table. Never export credential hashes or connector secrets into tickets or logs.

For each person who must retain access, obtain the exact `iss` and `sub` from the configured OIDC provider. Do not infer `sub` from email, display name, username, or provider administration UI labels. Build an operator-reviewed mapping like:

```json
[
  {
    "issuer": "https://identity.example/tenant",
    "subject": "00u2abc123stable",
    "legacyUserId": "existing-zme-user-id"
  }
]
```

Each identity and each old user ID may appear once. Store this JSON as `OIDC_LEGACY_BINDINGS_JSON` for the first deployment and retain the reviewed mapping as a migration audit artifact. Unmapped users and all their data remain in the database, disabled from login but not deleted.

## 2. Register the OIDC client

Register these exact URLs at the provider:

- redirect URI: `https://zme.example/auth/callback`
- post-logout redirect URI: `https://zme.example/login`

The provider must publish standard discovery metadata, a JWKS URI, Authorization Code Flow, and PKCE S256. Configure the token endpoint authentication method exactly as registered. Prefer a public client with `none` plus PKCE where provider policy allows it; otherwise store the client secret as a Worker secret.

Set at least one `OIDC_ADMIN_SUBJECTS` entry to an exact `sub` from the configured issuer. This is the only administrator bootstrap mechanism. Database emptiness and login order never grant administrator access.

If upgrading an earlier preview of this breaking release, remove the `issuer|` prefix from every administrator entry before deployment. Production releases before this migration did not support this variable.

## 3. Apply the staged migration

In a maintenance window:

```bash
pnpm db:check
pnpm db:migrate:remote
```

The first migration adds OIDC projection fields, safe session/transaction tables, replay protection, and resource lifecycle tables while the historical identity tables still exist. The second snapshots every affected child graph, creates the final projection without credential-era email-verification or ban fields, copies user IDs into it, rewires every ownership foreign key, restores authoritative snapshots in dependency order, then removes the obsolete credential/session tables and temporary projection. The third is the generated Drizzle metadata checkpoint for that final schema and does not mutate data. The fourth adds persisted downstream progress/result fields and clears the historical misuse of `completed_at` on merely submitted tasks. The fifth adds release-search recovery leases and downstream snapshot revisions; existing rows receive null values and remain readable. The sixth adds owned connector-sync job resources without changing or deleting connector data. The seventh adds per-user idempotency, recoverable worker leases, and a composite connector/user ownership constraint. Existing connector-sync jobs remain in place and receive deterministic `legacy:<job-id>` audit keys plus null leases; their results, errors, timestamps, and ownership are preserved.

The representative upgrade test inventories every table carrying `user_id` and verifies every direct and transitive ownership edge: application sessions, connector login attempts, connectors and connector-sync jobs, downloaders, library items, music collections/tracks/availability/download keys, media subscriptions/download records and their join, release-search jobs/results, and manual download tasks. It also checks safe null defaults for new lease/revision columns and requires an empty `PRAGMA foreign_key_check` result. The reviewed identity binding artifact and protected pre-migration backup are the audit and rollback records; credential hashes are intentionally not retained in the runtime projection.

Before exposing the Worker, audit the migrated database:

```sql
SELECT id, issuer, subject, identity_bound_at, disabled FROM users ORDER BY id;
SELECT issuer, subject, COUNT(*) AS identities FROM users
WHERE issuer IS NOT NULL OR subject IS NOT NULL
GROUP BY issuer, subject HAVING identities > 1;
SELECT user_id, COUNT(*) FROM library GROUP BY user_id;
SELECT user_id, COUNT(*) FROM connectors GROUP BY user_id;
SELECT user_id, COUNT(*) FROM download_records GROUP BY user_id;
```

The duplicate query must return no rows. Ownership counts must match the pre-migration inventory. A mapped subject is bound to its existing user ID on first successful OIDC login. The binding is transactional and refuses a subject or old user already bound elsewhere.

## 4. Verify and remove temporary mappings

Sign in as every mapped administrator/operator, verify the displayed issuer and subject, and inspect representative owned resources. Confirm unmapped subjects create new projections and never attach to a row with the same email. After all intended old rows show the reviewed issuer, subject, and `identity_bound_at`, remove `OIDC_LEGACY_BINDINGS_JSON` from the runtime configuration; the durable projection remains bound.

## Rollback

Stop writes first. If validation fails before meaningful post-migration writes, deploy the previous Worker and restore the pre-migration D1 export as a unit. Do not attempt to recreate removed credential tables from OIDC projection fields. If new writes must be preserved, keep the new database offline, export the affected business rows for an explicit reconciliation, and restore only after operator review. Never resolve rollback conflicts by deleting users or reassigning ownership by email.

The historical Better Auth name may appear only in migration history and this migration explanation; no runtime package, route, schema owner, UI, configuration, or test helper depends on it.
