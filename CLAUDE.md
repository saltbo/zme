# ZME — agent guide

Media discovery SPA that saves remote resources into downloaders. Hono API on
Cloudflare Workers (serving the React SPA as static assets) + D1.

## Architecture (clean architecture; the `hono-cf-clean-arch` skill is the full spec)

The server is layered; dependencies point inward and are enforced by
`.dependency-cruiser.cjs` (`pnpm lint:arch`):

- `server/domain/` — pure business rules, zero outward imports.
- `server/usecases/` — application operations over `ports.ts`; takes `deps` first.
- `server/adapters/` — port implementations: `repos/` (the only place drizzle/the
  schema are touched), `providers/` + `gateways/` (the only place `fetch` is called).
- `server/http/` — Hono routes (split by resource), zod validation, error mapping.
- `server/composition.ts` — `createDeps(env)`, the only place adapters are constructed.
- `server/worker.ts` — the Workers entry (fetch + scheduled).
- `shared/` — the API contract (DTOs + pure helpers), imported by both halves.
- `src/` — the React SPA; not governed by the server layers (see the skill's
  lightweight frontend rules). `src/lib/api/` mirrors `server/http/`.

Path aliases: `@/` → `src/`, `@server/` → `server/`, `@shared/` → `shared/`. The two
halves meet only through `@shared`; both cross-import directions are forbidden by
dependency-cruiser. Use `@server/` for cross-directory server imports, `./` for
same-directory siblings.

## Gates (all must pass; CI runs them)

- `pnpm lint` — Biome.
- `pnpm lint:arch` — dependency-cruiser architecture boundaries.
- `pnpm typecheck` — tsc (server + web).
- `pnpm test` — vitest `unit` (node) + `api` (workerd + real D1) projects.
- `pnpm build` — vite/Workers build.

`pnpm cf-typegen` regenerates the (gitignored) env types from wrangler.toml +
`.dev.vars.example`; it also runs on install.

## Notes

- Env type is `Cloudflare.Env` (generated); edit bindings in `wrangler.toml`, not by hand.
- Migrations are generated, never hand-written: edit `server/db/schema.ts`, then
  `pnpm db:generate` (drizzle-kit) emits the diff into `migrations/`. The legacy
  0001-0010 SQL predate drizzle-kit and stay as applied history; `migrations/meta/`
  is drizzle's baseline snapshot. CI fails if `schema.ts` changed without generating.
- `server/clients/zpan/` is generated (`pnpm openapi:zpan`) — don't hand-edit.
- Local verification account: see AGENTS.md.
