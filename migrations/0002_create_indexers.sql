CREATE TABLE indexers (
  id TEXT PRIMARY KEY NOT NULL,
  description TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('prowlarr')),
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

CREATE INDEX indexers_enabled_idx ON indexers (enabled);
CREATE INDEX indexers_kind_idx ON indexers (kind);
