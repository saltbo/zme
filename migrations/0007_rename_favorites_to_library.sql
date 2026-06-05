ALTER TABLE favorites RENAME COLUMN favorited_at TO saved_at;
ALTER TABLE favorites RENAME TO library;

DROP INDEX IF EXISTS favorites_media_key_idx;
DROP INDEX IF EXISTS favorites_created_at_idx;
DROP INDEX IF EXISTS favorites_user_media_key_idx;
DROP INDEX IF EXISTS favorites_user_id_idx;

CREATE INDEX library_created_at_idx ON library (created_at);
CREATE UNIQUE INDEX library_user_media_key_idx ON library (user_id, media_key);
CREATE INDEX library_user_id_idx ON library (user_id);
