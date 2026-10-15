---
name: use-zme
description: Use ZME through Realmroot to browse the media catalog, charts, and available torrents, download locally through the system's associated client or submit to a remote downloader, and inspect or manage owned remote downloads. Use for the user's private ZME media and download workflows with controller-approved access.
---

# Use ZME

Treat ZME as the user's private media library and download desk. Operate it only
through the stable Agent identity and authority supplied by `$realmroot`. Do
not borrow a user's browser session, cookies, OIDC tokens, or API keys.

## Discover The Live Contract

Confirm the Agent identity and discover ZME before every new workflow or after
an authorization or contract failure:

```bash
realmroot agent whoami --json
realmroot toolbox zme
```

Require the discovered Resource Server URL to be the intended ZME deployment.
If `zme` is absent, report that Realmroot has no matching Resource Server rather
than bypassing Realmroot.

Search for the capability and inspect the selected operation before requesting
authority or calling it:

```bash
realmroot toolbox zme --search "<capability>"
realmroot toolbox zme <group> <operation> --help
```

Treat Toolbox output as authoritative for operation names, arguments, scopes,
and response shapes. Do not assume that examples below replace live discovery.

## Request Least-Privilege Authority

Request the union of scopes required for the user's current workflow in one
controller approval. Omit unrelated scopes:

```bash
realmroot agent request \
  --resource-server zme \
  --scope <scope> \
  --reason "Use ZME for the requested media workflow"
```

Repeat `--scope` for each required scope. Typical scope mapping is:

- read/search the movie, series, book, and music catalogs: `media:read`;
- read the represented user’s library and music collection tracks: `library:read`;
- search downloadable resources: `torrents:read`;
- list safe downloader choices: `downloaders:read`;
- create a local or remote download: `downloads:write` (local does not need `downloaders:read`);
- inspect downloads: `downloads:read`;
- suspend, resume, cancel, or delete a download: `downloads:manage`.

Safe downloader choices are readable in the `configuration` group with
`downloaders:read`; that does not authorize configuration writes.
Do not request browser-session-only configuration authority. ZME configuration
of media sources, indexers, downloader credentials, connectors, and site
administration is outside Agent access.

## Find A Download And Choose Its Destination

Execute only the steps needed by the request. Add `--json` to retain structured
results.

1. Search media and select the intended result's `mediaKey`:

   ```bash
   realmroot toolbox zme catalog list-catalog-items "<query>" --json
   ```

2. Query the `torrents` collection with `q`; supply the selected `mediaKey`
   using the optional argument shown in live help. Select an opaque torrent `id`. Present materially different release choices to the user when
   quality, language, edition, or size preferences are unresolved. Indexers can
   take up to two minutes to answer, so allow one long request instead of restarting
   the complete search on transient responses. Torrent lists intentionally omit
   the downloader `resourceRef`:

   ```bash
   realmroot toolbox zme torrents list-torrents \
     "<query>" --retry 0 --timeout 150s --no-cache --json
   ```

3. Retrieve the selected torrent by ID. Supply the same selected `mediaKey` and
   `target` from step 2 when preparing its download reference; these are context,
   not part of the torrent identity. Use the returned opaque
   `resourceRef` only for the immediate download creation:

   ```bash
   realmroot toolbox zme torrents get-torrent \
     "<torrent-id>" --json
   ```

4. Honor the requested destination: local and remote are alternatives. For local
   downloads, follow **Download Locally** below and stop this remote sequence.
   If the destination is unspecified and cannot be inferred, ask which destination
   the user wants. For remote downloads, list safe downloader choices and select
   an enabled downloader ID:

   ```bash
   realmroot toolbox zme configuration list-downloaders --json
   ```

5. Discover `create-download` argument syntax, then create the remote download
   with `downloaderId` and a new unique `Idempotency-Key` header. Preserve the key
   only when retrying the identical request after an uncertain transport result:

   ```bash
   realmroot toolbox zme downloads create-download --help
   ```

   The corresponding HTTP request is:

   ```http
   POST /api/downloads
   Idempotency-Key: <unique-key>
   Content-Type: application/json

   {"resourceRef":"<resource-ref>","downloaderId":"<downloader-id>"}
   ```

6. Read the created download back and report its current state:

   ```bash
   realmroot toolbox zme downloads get-download "<download-id>" --json
   ```

Never reconstruct, edit, or persist an opaque `resourceRef`; retrieve it through
`get-torrent` for the selected torrent and use the exact current
value returned by ZME.

## Books, Music, And Library Tracks

Use the same catalog resources as the browser, all with `media:read`:

- `catalog`: `listMovies`, `listSeries`, `listBooks`, and `listAlbums` query the
  content collections; `listCatalogItems` is the mixed movie/series search view.
- Book works and book editions have distinct canonical addresses. Use
  `listBookEditions` and follow each edition's `links.self`; `listBookEditionsByIsbn`
  resolves an ISBN to its canonical edition.
- Albums, album editions, recordings, and track positions are distinct. Use
  `listAlbumEditions` for an album's versions. Disc and track positions belong to
  a specific edition; a track can link to a recording shared by several editions.
- `charts`: discover `listCharts`, then follow the selected chart's `links.entries`
  with a period from that definition. Entries have `{rank, item}`; catalog filters
  belong on content collections, not on chart reads. Charts may omit unknown totals.

Use `listTorrents` for available BT sources. Public search parameters are `q`,
optional `mediaKey`, and `target`; never send Prowlarr `searchType` or category IDs.
Book associations require `target=ebook` or `target=audiobook`; music album
associations require `target=music`. Movie/series associations omit `target`.
Pass the same association to `getTorrent` to obtain the immediate `resourceRef`.
For example, the corresponding HTTP contract for a book is:

```http
GET /api/torrents?q=<keywords>&mediaKey=<book-key>&target=ebook
GET /api/torrents/<torrent-id>?mediaKey=<book-key>&target=ebook
```

Use Toolbox's live help for optional argument syntax. Torrent pages include an
owned `snapshotId` and `expiresAt`; follow the returned pagination `Link` URLs
instead of rerunning the search for each page. A snapshot is a temporary query
view, not a download or background search job. Do not treat an album or catalog
recording as an owned downloadable library track.

For direct music downloads, request `library:read` and discover the `library`
operations `listMusicCollections`, `getMusicCollection`, and
`getFavoriteMusicCollection`. Read an owned collection to obtain actual track
`mediaKey` values. Create a local or remote download with
`resourceRef: music-track:<returned-mediaKey>` and `downloads:write`.
No connector credentials or browser session is required for these reads.

## Download Locally

Use the same selected torrent and current `resourceRef` as the browser. Discover
`createDownload` in the live contract. Omit `downloaderId` to prepare a local download:

```bash
realmroot toolbox zme downloads create-download \
  'resourceRef: "<resource-ref>"' --json
```

This calls `POST /api/downloads` with `{ "resourceRef": "..." }`.
Both destinations use this operation: omitting `downloaderId` selects local;
supplying it selects remote. Local preparation requires `downloads:write`,
needs no `Idempotency-Key`, and creates no remote task. Repeating it issues a
fresh temporary capability. For a known music library track, the reference is
`music-track:<mediaKey>`; do not invent a media key or bypass library ownership.

The result is discriminated by `kind` and always contains `href`, `expiresAt`,
and `links.self`:

- `kind: magnet`: give the exact `href` to the operating system's URL opener.
- `kind: file`: fetch the exact ZME `href` and save the attachment using
  `filename`. A `mediaType` of `application/x-bittorrent` is a torrent file;
  open that saved file through the system association. Other media files may
  be saved with `--save-only` when the request is only to download them.

`expiresAt` governs the temporary ZME capability. It does not make a magnet
URI itself expire. No original indexer download URL or credential is returned.

Use the system association; do not select or configure a local client. On macOS
use `open`, on Windows use the shell's associated-file opener, and on Linux use
`xdg-open`. Pass URIs and paths as arguments, never interpolate them into shell
code. The bundled helper implements this handoff from a JSON source object:

```bash
python3 scripts/open_local_download.py source.json --origin "<discovered-zme-origin>"
```

The script path is relative to this skill's directory. Save the returned resource
object, rather than a Toolbox envelope, as `source.json`. The helper validates
file URLs against the discovered ZME origin and never sends OIDC credentials.
Use `--directory` for an explicitly requested local save directory; `--save-only`
saves file sources without opening them. Download URLs are short-lived bearer
capabilities: do not log, publish, reconstruct, or replace them with indexer URLs.
The proxy returns the file itself; do not follow redirects to a torrent site.
If the ZME link expired, call `createDownload` again without `downloaderId` using the selected current reference.

Perform the handoff only on the user's device. A cloud/container Agent must not
open its own desktop or silently submit a remote task instead. When it cannot
execute on the user's device, provide the returned local handoff link (or the
ZME browser route) and state that the user must open it locally.

Report only what was verified: a source was prepared, a file was saved, or a
system-open request was accepted. System acceptance does not prove that a client
started or completed the media download. Local transfers are managed by the
system/client, not ZME's remote download monitor.

## Inspect Or Manage Downloads

Discover and inspect the live operation first, then use the appropriate owned
download ID:

```bash
realmroot toolbox zme downloads list-downloads --json
realmroot toolbox zme downloads get-download "<download-id>" --json
realmroot toolbox zme downloads create-download-suspension "<download-id>" --json
realmroot toolbox zme downloads delete-download-suspension "<download-id>" --json
realmroot toolbox zme downloads create-download-cancellation "<download-id>" --json
realmroot toolbox zme downloads delete-download "<download-id>" --json
```

After a mutation, read the download or the corresponding suspension or
cancellation Resource when available. Do not treat a successful command exit
as proof of the resulting state when a read-back operation exists.

Only poll remote tasks while `pollingRequired` is true. A task accepted by a
client with `monitoringSupported: false` is handed off; ZME cannot report its
file progress or completion. Follow management links only when they are present.

`submissionUnknown` means the client might already have accepted the task.
When `submissionRecoverySupported` is true, ZME can recover with the original
downstream idempotency key; preserve the original request/key if retrying.
When false, stop automatic submission retries and report that the remote client
must be checked. Never create another task with a new key to hide uncertainty.

## Handle Failures

- On `403`, re-read operation help and request only a scope the requested task
  actually needs.
- On `404`, confirm the represented user owns the Resource and that the ID came
  from the current ZME deployment.
- On idempotency conflict, do not generate a new key to disguise a changed
  request; reconcile the original operation first.
- On expired torrent query snapshots or resource references, repeat the torrent query and let the user
  reselect when the available release materially changed.
- On download-search timeout or `502`, retry the same read once only after the
  first long request has completed. Do not run concurrent download searches.
- On connection, discovery, or authorization failure, use `$realmroot` to
  diagnose and restore Agent access. Never fall back silently to user identity.
