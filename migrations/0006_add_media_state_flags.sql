ALTER TABLE favorites ADD COLUMN favorited_at TEXT;
ALTER TABLE favorites ADD COLUMN watched_at TEXT;

UPDATE favorites SET favorited_at = created_at WHERE favorited_at IS NULL;
