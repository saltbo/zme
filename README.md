# ZME

ZME is a media discovery frontend for saving remote resources into ZPan.

## Stack

- React 19 + React Router 7
- Hono RPC API
- Cloudflare Workers + static assets
- Tailwind CSS 4
- Biome + TypeScript + Vitest

## Local Development

Create `.dev.vars` with the external services you want to test:

```dotenv
TMDB_API_KEY=your_tmdb_v4_read_access_token
TMDB_LANGUAGE=zh-CN
ZPAN_BASE_URL=http://localhost:5174
```

Then run:

```bash
pnpm install
pnpm dev
```

ZME does not run indexers or downloaders inside Workers. Users connect their own Prowlarr and downloader services from the application settings.
