# Library

A user's saved/watched media, keyed by media key.

### `library/list-states`
The library reflects the saved/watched state of the user's items.

- **Given** a user with saved items
- **When** the library loads
- **Then** each item reports its saved/watched status

_Verified at: web_

### `library/save-resource`
Saving an item that isn't in the library marks it as saved.

- **Given** an authenticated user and an item not in their library
- **When** they save the item
- **Then** the item is listed as saved

_Verified at: web_

### `library/watch-resource`
Marking an item watched records it as watched (and saved).

- **Given** an authenticated user
- **When** they mark an item watched
- **Then** the item reports the watched status

_Verified at: web_

### `library/remove-resource`
Removing a saved item drops it from the library.

- **Given** a user with a saved item
- **When** they remove it
- **Then** the item is no longer in the library

_Verified at: web_

### `library/book-music-no-tmdb`
Book and music library kinds are served without requiring a TMDB source.

- **Given** no TMDB media source is configured
- **When** the library is listed for the book or music kind
- **Then** the API returns an empty page instead of an error

_Verified at: api_
