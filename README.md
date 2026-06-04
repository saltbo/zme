# ZME

ZME is a media discovery frontend for saving remote resources into ZPan.

## Stack

- React 19 + React Router 7
- Hono RPC API
- Cloudflare Workers + static assets
- Tailwind CSS 4
- Biome + TypeScript + Vitest

## Local Development

Create `.dev.vars` with the auth secret:

```dotenv
BETTER_AUTH_SECRET=replace-with-at-least-32-random-characters
```

Then run:

```bash
pnpm install
pnpm dev
```

On first launch, ZME opens the onboarding flow to create the first administrator. TMDB is configured in Admin -> Media sources. Indexers and downloaders are also administrator-managed settings.

For deployed Workers, set the auth secret with:

```bash
wrangler secret put BETTER_AUTH_SECRET
```

ZME does not run indexers or downloaders inside Workers. Administrators connect Prowlarr and downloader services from the admin area.
