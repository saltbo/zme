CREATE TABLE library_sources (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('douban')),
  profile_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_synced_at TEXT,
  last_error TEXT,
  last_result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX library_sources_user_source_idx ON library_sources (user_id, source);
CREATE INDEX library_sources_enabled_idx ON library_sources (enabled);
