# Admin connectors

Administrators manage external connectors (media sources, indexers, downloaders).
Connector config is stored; credentials never appear in list/summary responses.

### `admin/media-source-crud`
An administrator can create, read, update, and delete a media source, and its
credentials are never exposed in summaries.

- **Given** an authenticated administrator
- **When** they create, fetch, update, and delete a media source
- **Then** each step succeeds and summary responses omit credentials

_Verified at: api_

### `admin/downloader-crud`
An administrator can manage downloaders, scoped to their own user.

- **Given** an authenticated administrator
- **When** they create, list, and delete a downloader
- **Then** each step succeeds and only their own downloaders are listed

_Verified at: api_
