# Contributing to ZME

Thanks for your interest in improving ZME. This guide covers everything you need to
develop, test, and submit changes. For a high-level "what and why", see the
[README](README.md).

## Prerequisites

- **Node.js ≥ 24** and **pnpm 10** (the repo pins exact versions via `volta` and
  `packageManager`).
- A Cloudflare account is only needed for deployment, not for local development —
  the dev server runs Workers locally via Wrangler/Miniflare with a local D1.

## Setup

```bash
git clone https://github.com/saltbo/zme.git
cd zme
pnpm install          # also runs `cf-typegen` to generate env types
```

Create a `.dev.vars` by copying `.dev.vars.example`. Supply a standard external
OIDC issuer/client, exact redirect and logout URLs, an explicit administrator
`issuer|subject`, the exact resource URL, and the independent connector secret.
Security-critical identity configuration is validated fail-fast. See
[OIDC deployment](docs/oidc-deployment.md).

Start the app:

```bash
pnpm dev              # http://localhost:7171
```

`.dev.vars.example` is also the source of binding/var names for `wrangler types`, so
keep its keys in sync when you add a binding.

## Project layout (clean architecture)

The server is layered; **dependencies point inward** and are enforced by
`.dependency-cruiser.cjs` (`pnpm lint:arch`). The `hono-cf-clean-arch` skill is the
full spec, but in short:

- `server/domain/` — pure business rules, zero outward imports.
- `server/usecases/` — application operations defined over `ports.ts`; each takes its
  `deps` first.
- `server/adapters/` — port implementations:
  - `repos/` — the **only** place Drizzle and the schema are touched.
  - `providers/` + `gateways/` — the **only** place `fetch` is called (TMDB, Open
    Library, ListenBrainz, Prowlarr, downloaders, …).
- `server/http/` — Hono routes (split by resource), Zod validation, versioning,
  Problem Details, OIDC/DPoP authorization, and OpenAPI publication.
- `server/composition.ts` — `createDeps(env)`, the only place adapters are constructed.
- `server/worker.ts` — the Workers entry (`fetch` + `scheduled`).
- `shared/` — the API contract (DTOs + pure helpers), imported by both halves.
- `src/` — the React SPA; `src/lib/api/` mirrors `server/http/`.

### Import boundaries

Path aliases: `@/` → `src/`, `@server/` → `server/`, `@shared/` → `shared/`.

- The frontend (`src/`) and backend (`server/`) meet **only** through `@shared`. Both
  cross-import directions are forbidden by dependency-cruiser.
- Use `@server/` for cross-directory server imports and `./` for same-directory
  siblings.

## Gates

All of these must pass; CI runs them. Run them locally before opening a PR:

| Command | What it checks |
| --- | --- |
| `pnpm lint` | Biome (lint + format). |
| `pnpm lint:arch` | dependency-cruiser architecture boundaries. |
| `pnpm typecheck` | `tsc` for both server and web. |
| `pnpm openapi:lint && pnpm openapi:diff` | strict OpenAPI validation and reviewed semantic-signature drift. |
| `pnpm quality:inventory` | Gherkin/native-test traceability, evidence paths, and static skip/focus audit. |
| `pnpm test:ci` | Vitest `unit`, `web`, and `api` projects plus reconciliation of the native JSON report and every discovered test file. |
| `pnpm test:coverage && pnpm test:coverage:task` | repository baseline regression and 90% changed-executable-line threshold across every task-owned Unit module. |
| `pnpm e2e:ci` | real Chromium OIDC login/session/logout and critical UI behavior plus reconciliation of the Playwright JSON report. |
| `pnpm build` | Vite / Workers production build. |

Quick fixes: `pnpm lint:fix` (Biome autofix) and `pnpm format`.

## Testing

Tests run on three tiers:

- **Unit** — pure node tests (`vitest --project unit`), including
  `pnpm test:coverage`.
- **API** — run in `workerd` against a real local D1 (`vitest --project api`), so
  routes and repos are exercised end-to-end against SQLite.
- **E2E** — Playwright (`pnpm e2e`) drives the real stack (SPA + Worker + isolated
  D1) with the protocol-faithful local OIDC/JWKS provider in
  `scripts/fake-oidc-provider.mjs`. The store is reset and migrated on each boot;
  tests cover Authorization Code + PKCE, callback, cookie, reload, and logout.

The `:ci` variants retain the native runner output and then mechanically reconcile totals, failures, pending/skipped/flaky results, and discovered test-file inventory. Generated reports are ignored under `reports/`.

`pnpm test:watch` runs Vitest in watch mode.

### Local browser verification

For manual browser checks, use the configured local OIDC subject. The app exposes
no self-service registration or local credentials. The hermetic browser suite uses
subject `e2e-admin`; a real provider deployment must use the subject configured in
`OIDC_ADMIN_SUBJECTS`.

## Database & migrations

Migrations are **generated, never hand-written**:

1. Edit `server/db/schema.ts`.
2. Run `pnpm db:generate` (drizzle-kit) to emit the diff into `migrations/`.
3. Apply locally with `pnpm db:migrate:local` (or `:remote` for deployed Workers).

Identity upgrades require the additional backup, ownership inventory, explicit
`iss`/`sub` binding, audit, and rollback steps in [OIDC migration](docs/oidc-migration.md).
Never link identities by email.

`pnpm db:check` validates the schema. CI fails if `schema.ts` changed without
generating a migration. The legacy `0001`–`0010` SQL files predate drizzle-kit and
remain as applied history; `migrations/meta/` is drizzle's baseline snapshot.

## Code generation

- `pnpm cf-typegen` regenerates the (gitignored) `Cloudflare.Env` types from
  `wrangler.toml` + `.dev.vars.example`. It also runs on install. Edit bindings in
  `wrangler.toml`, never the generated types by hand.
- `server/clients/zpan/` is generated via `pnpm openapi:zpan` — don't hand-edit it.

## Conventions

- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/)
  with a scope, e.g. `feat(library): …`, `refactor(server): …`, `test(api): …`,
  `chore(infra): …`. `husky` + `lint-staged` format staged files on commit.
- **Style** is enforced by Biome — don't fight the formatter.
- **Design** changes should respect the system documented in [DESIGN.md](DESIGN.md).

## Submitting a pull request

1. Branch off `main`.
2. Make your change with tests where it makes sense.
3. Ensure every gate above passes locally.
4. Open a PR with a clear description of the what and why.
