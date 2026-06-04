CREATE TABLE favorites (
  id TEXT PRIMARY KEY NOT NULL,
  media_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('movie', 'tv')),
  tmdb_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  original_title TEXT NOT NULL,
  overview TEXT NOT NULL,
  poster_url TEXT,
  backdrop_url TEXT,
  release_year TEXT,
  rating REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX favorites_media_key_idx ON favorites (media_key);
CREATE INDEX favorites_created_at_idx ON favorites (created_at);
