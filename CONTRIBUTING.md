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

Create a `.dev.vars` (copy `.dev.vars.example`) with at least:

```dotenv
BETTER_AUTH_SECRET=replace-with-at-least-32-random-characters
```

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
- `server/http/` — Hono routes (split by resource), Zod validation, error mapping.
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
| `pnpm test` | Vitest `unit` (node) + `api` (workerd + real D1) projects. |
| `pnpm build` | Vite / Workers production build. |

Quick fixes: `pnpm lint:fix` (Biome autofix) and `pnpm format`.

## Testing

Tests run on three tiers:

- **Unit** — pure node tests (`vitest --project unit`), including
  `pnpm test:coverage`.
- **API** — run in `workerd` against a real local D1 (`vitest --project api`), so
  routes and repos are exercised end-to-end against SQLite.
- **E2E** — Playwright (`pnpm e2e`) drives the real stack (SPA + Worker + isolated
  D1). The E2E store is reset and migrated by `pnpm e2e:server` on each boot and runs
  serially because it drives the onboarding flow.

`pnpm test:watch` runs Vitest in watch mode.

### Local browser verification

For manual browser checks, use the admin account from `.dev.vars`
(`LOCAL_TEST_EMAIL` / `LOCAL_TEST_PASSWORD`). The app does **not** expose
self-service registration locally — log in with those credentials rather than trying
to register a new user.

## Database & migrations

Migrations are **generated, never hand-written**:

1. Edit `server/db/schema.ts`.
2. Run `pnpm db:generate` (drizzle-kit) to emit the diff into `migrations/`.
3. Apply locally with `pnpm db:migrate:local` (or `:remote` for deployed Workers).

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
