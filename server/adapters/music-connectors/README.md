# Music connectors

Each provider owns one directory containing its authentication, API client, mapping, availability, and resource-resolution code. Generic authentication, sync, and download use cases only depend on `MusicConnectorModule` from `server/usecases/ports.ts`.

Authentication is a provider-neutral state machine. A provider implements `auth.start` and `auth.continue`, returns an opaque state plus a public challenge, and never adds HTTP routes or shared provider-specific input types. ZME encrypts opaque state between transitions and saves connected credentials without interpreting either value.

To add a provider:

1. Add a new provider directory that exports one `MusicConnectorModule`.
2. Register the module in `registry.ts`.
3. Add its isolated UI module under `src/features/music-connectors/` and register it in the frontend registry.

Do not add provider routes under `server/http/` or provider functions under `src/lib/api/`. Every provider uses `/api/connector-login-attempts` and its generic continuation endpoint.

Provider directories must not import each other or either registry. Architecture lint enforces that boundary.
