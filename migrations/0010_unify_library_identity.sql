CREATE TABLE library_next (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  media_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('movie', 'tv', 'music', 'book')),
  tmdb_id INTEGER,
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
  MIN(id) AS id,
  user_id,
  normalized_media_key,
  kind,
  tmdb_id,
  MIN(saved_at) AS saved_at,
  MIN(watched_at) AS watched_at,
  MIN(created_at) AS created_at,
  MAX(updated_at) AS updated_at
FROM (
  SELECT
    id,
    user_id,
    CASE
      WHEN kind IN ('movie', 'tv') AND media_key = kind || ':' || tmdb_id THEN 'tmdb:' || kind || ':' || tmdb_id
      ELSE media_key
    END AS normalized_media_key,
    kind,
    tmdb_id,
    saved_at,
    watched_at,
    created_at,
    updated_at
  FROM library
)
GROUP BY COALESCE(user_id, id), normalized_media_key, kind, tmdb_id;

DROP INDEX IF EXISTS library_created_at_idx;
DROP INDEX IF EXISTS library_user_media_key_idx;
DROP INDEX IF EXISTS library_user_id_idx;

DROP TABLE library;
ALTER TABLE library_next RENAME TO library;

CREATE INDEX library_created_at_idx ON library (created_at);
CREATE UNIQUE INDEX library_user_media_key_idx ON library (user_id, media_key);
CREATE INDEX library_user_id_idx ON library (user_id);
