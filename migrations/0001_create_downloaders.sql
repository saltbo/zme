CREATE TABLE downloaders (
  id TEXT PRIMARY KEY NOT NULL,
  description TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('zpan', 'qbittorrent', 'transmission', 'aria2')),
  endpoint TEXT NOT NULL,
  credentials_json TEXT NOT NULL DEFAULT '{}',
  options_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  health_status TEXT NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('unknown', 'online', 'offline')),
  health_message TEXT,
  health_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX downloaders_enabled_idx ON downloaders (enabled);
CREATE INDEX downloaders_kind_idx ON downloaders (kind);
