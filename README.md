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
PROWLARR_URL=http://127.0.0.1:9696
PROWLARR_API_KEY=your_prowlarr_api_key
ZPAN_BASE_URL=http://localhost:5174
```

Then run:

```bash
pnpm install
pnpm dev
```

ZME does not run indexers or downloaders inside Workers. Prowlarr, bitmagnet, Jackett, and ZPan offline download are external services called by this frontend/API layer.
