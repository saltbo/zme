<div align="center">

# ZME

**A private media desk — discover movies, series, anime, music, and books, then push a release straight to your downloader.**

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](#license)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)
![React 19](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-API-E36002?logo=hono&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)

![Discover](docs/screenshots/discover.jpg)

</div>

## What is ZME?

ZME is a self-hosted, single-page web app that unifies media **discovery** and
**acquisition** in one surface. Browse trending and popular titles pulled from
TMDB (movies / series / anime), Open Library (books), and ListenBrainz (music);
open a title for rich detail; then search your indexers for a release and hand it
off to your download client — all without leaving the page.

It runs entirely on Cloudflare's edge: a [Hono](https://hono.dev) API on
[Workers](https://workers.cloudflare.com) serves the React SPA as static assets and
keeps state in [D1](https://developers.cloudflare.com/d1/). There's no always-on
server to babysit.

## What problem does it solve?

Self-hosted media stacks are powerful but fragmented: you discover something in one
app, search for a release in another (Prowlarr), and queue it in a third
(qBittorrent / Transmission / …). ZME collapses that loop into a single private desk:

- **One place to discover** across movies, series, anime, music, and books.
- **One step from a title to a release** — ZME queries your configured indexers
  (via Prowlarr) for you.
- **One step from a release to a download** — push it straight to your
  **download client**, no copy-pasting magnet links.
- **A personal library and a download monitor** to track what you saved and how
  downloads are progressing.

Everything is admin-managed and private: identity comes from your external OIDC
provider, ZME offers no local sign-up or passwords, and your API keys and indexer /
downloader endpoints stay inside your own deployment. Realmroot deployments can
also expose a least-privilege, DPoP-bound Agent workflow.

## Screenshots

| Title detail | My Library | Downloads |
| :---: | :---: | :---: |
| [![Title detail](docs/screenshots/media-detail.jpg)](docs/screenshots/media-detail.jpg) | [![My Library](docs/screenshots/library.jpg)](docs/screenshots/library.jpg) | [![Downloads](docs/screenshots/downloads.jpg)](docs/screenshots/downloads.jpg) |

## Getting started

### Prerequisites

- **Node.js ≥ 24** and **pnpm 10**
- A **TMDB API key** for discovery (configured inside the app)
- Optional, but that's the point: a **Prowlarr** instance for indexer search and a
  **download client** (qBittorrent / Transmission / Aria2 / ZPan)

### Run it locally

```bash
git clone https://github.com/saltbo/zme.git
cd zme
pnpm install
```

Register a standard OIDC client, then copy `.dev.vars.example` to `.dev.vars` and
set the exact issuer, client, redirect/logout URLs, administrator `issuer|subject`,
resource URL, and an independent connector-encryption secret:

```dotenv
PUBLIC_APP_ORIGIN=http://localhost:7171
OIDC_ISSUER=https://identity.example/tenant
OIDC_CLIENT_ID=zme-local
OIDC_TOKEN_ENDPOINT_AUTH_METHOD=none
OIDC_REDIRECT_URI=http://localhost:7171/auth/callback
OIDC_POST_LOGOUT_REDIRECT_URI=http://localhost:7171/login
OIDC_ALLOWED_ALGS=ES256
OIDC_ADMIN_SUBJECTS=https://identity.example/tenant|your-subject
REALMROOT_RESOURCE_URL=http://localhost:7171/api
CONNECTOR_CREDENTIALS_SECRET=replace-with-a-different-32-character-secret
```

Then start the dev server:

```bash
pnpm dev          # → http://localhost:7171
```

Sign in through the external provider. The first administrator is the explicitly
configured subject—login order never grants privileges. Then connect your **media
sources**, **indexers**, and **downloaders** from the Admin area. ZME doesn't run
those services itself; it talks to the instances you configure.

OIDC client setup, exact environment rules, and an upgrade runbook are documented
in [external OIDC deployment](docs/oidc-deployment.md) and
[OIDC migration](docs/oidc-migration.md).

### Deploy to Cloudflare

```bash
wrangler secret put OIDC_CLIENT_SECRET          # only for a confidential OIDC client
wrangler secret put CONNECTOR_CREDENTIALS_SECRET
pnpm db:migrate:remote                   # apply D1 migrations
pnpm deploy
```

## Tech overview

| Layer | Stack |
| --- | --- |
| Frontend | React 19, React Router 7, TanStack Query, Tailwind CSS 4, i18n (中文 / English) |
| Backend | Versioned, resource-oriented Hono API on Cloudflare Workers, serving the SPA as static assets |
| Identity | External standard OIDC; Authorization Code + PKCE; secure opaque local sessions; optional Realmroot Native DPoP access |
| Data | Cloudflare D1 (SQLite) via Drizzle ORM |
| Integrations | TMDB, Open Library, ListenBrainz (discovery) · Douban and Netease Cloud Music (connectors) · Prowlarr (indexers) · qBittorrent / Transmission / Aria2 / ZPan (downloaders) |
| Tooling | TypeScript, Biome, Vitest, Playwright, Wrangler, pnpm |

The server follows a clean, layered architecture (domain → use cases → adapters →
HTTP) with the two halves meeting only through a shared API contract. The full
layout, boundaries, and conventions live in the contributor guide — see below.
The Realmroot-safe contract is published at `/api/openapi.json`; see the
[Resource Server guide](docs/realmroot-resource-server.md).

## Contributing

Contributions are welcome. The development workflow, architecture, gates, testing
tiers, and database/codegen conventions are documented in
**[CONTRIBUTING.md](CONTRIBUTING.md)**. The design system reference is in
[DESIGN.md](DESIGN.md).

## Disclaimer

ZME is intended for **self-hosted, personal or household use only**. It does not
store downloaded media, but it may temporarily proxy content from a service you
connect to a downloader you configure. You are solely responsible for how you
use it and for complying with the laws and the terms of those services in your
jurisdiction.

**Running this project for commercial purposes is entirely at your own risk; you
assume all resulting legal liability.** The software is provided "as is", without
warranty of any kind, as set out in the license below.

## License

[AGPL-3.0-only](https://www.gnu.org/licenses/agpl-3.0.en.html).
