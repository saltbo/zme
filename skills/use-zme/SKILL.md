---
name: use-zme
description: Use ZME through Realmroot to search the media catalog, find release candidates, choose a downloader, create and inspect downloads, or suspend, resume, cancel, and delete owned downloads. Use whenever an Agent needs to browse or operate ZME media and download resources with controller-approved least-privilege access.
---

# Use ZME

Operate ZME only through the stable Agent identity and authority supplied by
`$realmroot`. Do not borrow a user's browser session, cookies, OIDC tokens, or
API keys.

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

- search media: `media:read`;
- search release candidates: `release-candidates:read`;
- list safe downloader choices: `downloaders:read`;
- create a download: `downloads:write`;
- inspect downloads: `downloads:read`;
- suspend, resume, cancel, or delete a download: `downloads:manage`.

Do not request browser-session-only configuration authority. ZME configuration
of media sources, indexers, downloader credentials, connectors, and site
administration is outside Agent access.

## Find And Download A Release

Execute only the steps needed by the request. Add `--json` to retain structured
results.

1. Search media and select the intended result's `mediaKey`:

   ```bash
   realmroot toolbox zme media-catalog list-media "<query>" --json
   ```

2. Search release candidates with that exact key and select an opaque
   `resourceRef`. Present materially different release choices to the user when
   quality, language, edition, or size preferences are unresolved:

   ```bash
   realmroot toolbox zme release-acquisition list-release-candidates \
     "<media-key>" "<query>" --json
   ```

3. List safe downloader choices and select an enabled downloader ID:

   ```bash
   realmroot toolbox zme downloads list-downloaders --json
   ```

4. Create the download with a new unique idempotency key. Preserve the same key
   only when retrying the identical request after an uncertain transport result:

   ```bash
   realmroot toolbox zme release-acquisition create-download \
     "<idempotency-key>" \
     'downloaderId: "<downloader-id>", resourceRef: "<resource-ref>"' \
     --json
   ```

5. Read the created download back and report its current state:

   ```bash
   realmroot toolbox zme release-acquisition get-download "<download-id>" --json
   ```

Never reconstruct, edit, or persist an opaque `resourceRef`; use the exact
value returned by the current candidate search.

## Inspect Or Manage Downloads

Discover and inspect the live operation first, then use the appropriate owned
download ID:

```bash
realmroot toolbox zme release-acquisition list-downloads --json
realmroot toolbox zme release-acquisition get-download "<download-id>" --json
realmroot toolbox zme downloads create-download-suspension "<download-id>" --json
realmroot toolbox zme downloads delete-download-suspension "<download-id>" --json
realmroot toolbox zme downloads create-download-cancellation "<download-id>" --json
realmroot toolbox zme downloads delete-download "<download-id>" --json
```

After a mutation, read the download or the corresponding suspension or
cancellation Resource when available. Do not treat a successful command exit
as proof of the resulting state when a read-back operation exists.

## Handle Failures

- On `403`, re-read operation help and request only a scope the requested task
  actually needs.
- On `404`, confirm the represented user owns the Resource and that the ID came
  from the current ZME deployment.
- On idempotency conflict, do not generate a new key to disguise a changed
  request; reconcile the original operation first.
- On expired candidate references, repeat candidate discovery and let the user
  reselect when the available release materially changed.
- On connection, discovery, or authorization failure, use `$realmroot` to
  diagnose and restore Agent access. Never fall back silently to user identity.
