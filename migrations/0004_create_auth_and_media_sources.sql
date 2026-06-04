CREATE TABLE user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  role TEXT DEFAULT 'user',
  banned INTEGER DEFAULT 0,
  ban_reason TEXT,
  ban_expires INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE session (
  id TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  impersonated_by TEXT
);

CREATE TABLE account (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  password TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE INDEX session_user_id_idx ON session (user_id);
CREATE INDEX account_user_id_idx ON account (user_id);

CREATE TABLE media_sources (
  id TEXT PRIMARY KEY NOT NULL,
  description TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('tmdb')),
  credentials_json TEXT NOT NULL DEFAULT '{}',
  options_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  health_status TEXT NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('unknown', 'online', 'offline')),
  health_message TEXT,
  health_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX media_sources_enabled_idx ON media_sources (enabled);
CREATE INDEX media_sources_kind_idx ON media_sources (kind);

ALTER TABLE favorites ADD COLUMN user_id TEXT REFERENCES user(id) ON DELETE CASCADE;
DROP INDEX favorites_media_key_idx;
CREATE UNIQUE INDEX favorites_user_media_key_idx ON favorites (user_id, media_key);
CREATE INDEX favorites_user_id_idx ON favorites (user_id);
