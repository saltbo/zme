CREATE TABLE library_next (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  media_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('movie', 'tv')),
  tmdb_id INTEGER NOT NULL,
  saved_at TEXT,
  watched_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO library_next (
  id,
  user_id,
  media_key,
  kind,
  tmdb_id,
  saved_at,
  watched_at,
  created_at,
  updated_at
)
SELECT
  id,
  user_id,
  media_key,
  kind,
  tmdb_id,
  saved_at,
  watched_at,
  created_at,
  updated_at
FROM library;

DROP INDEX IF EXISTS library_created_at_idx;
DROP INDEX IF EXISTS library_user_media_key_idx;
DROP INDEX IF EXISTS library_user_id_idx;

DROP TABLE library;
ALTER TABLE library_next RENAME TO library;

CREATE INDEX library_created_at_idx ON library (created_at);
CREATE UNIQUE INDEX library_user_media_key_idx ON library (user_id, media_key);
CREATE INDEX library_user_id_idx ON library (user_id);
