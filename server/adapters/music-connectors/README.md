# Music connectors

Each provider owns one directory containing its authentication, API client, mapping, availability, and resource-resolution code. Generic sync and download use cases only depend on `MusicConnectorModule` from `server/usecases/ports.ts`.

To add a provider:

1. Add a new provider directory that exports one `MusicConnectorModule`.
2. Register the module in `registry.ts`.
3. Add its isolated UI module under `src/features/music-connectors/` and register it in the frontend registry.

Provider directories must not import each other or either registry. Architecture lint enforces that boundary.
