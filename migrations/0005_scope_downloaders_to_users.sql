ALTER TABLE downloaders ADD COLUMN user_id TEXT REFERENCES user(id) ON DELETE CASCADE;

CREATE INDEX downloaders_user_id_idx ON downloaders (user_id);
CREATE INDEX downloaders_user_enabled_idx ON downloaders (user_id, enabled);
