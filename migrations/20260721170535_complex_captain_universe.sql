ALTER TABLE `music_tracks` ADD `album_artists_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `music_tracks` ADD `album_release_date` text;--> statement-breakpoint
ALTER TABLE `music_tracks` ADD `album_release_type` text;--> statement-breakpoint
ALTER TABLE `music_tracks` ADD `album_metadata_updated_at` text;--> statement-breakpoint
ALTER TABLE `music_tracks` ADD `disc_number` integer;--> statement-breakpoint
ALTER TABLE `music_tracks` ADD `track_number` integer;