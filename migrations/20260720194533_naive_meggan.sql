CREATE TABLE `connector_login_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`external_key` text NOT NULL,
	`credentials_encrypted` text,
	`status` text DEFAULT 'waiting_scan' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `music_collection_tracks` (
	`collection_id` text NOT NULL,
	`track_id` text NOT NULL,
	`position` integer NOT NULL,
	`added_at` text,
	FOREIGN KEY (`collection_id`) REFERENCES `music_collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `music_tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `music_collection_tracks_collection_track_idx` ON `music_collection_tracks` (`collection_id`,`track_id`);--> statement-breakpoint
CREATE TABLE `music_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`connector_id` text,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`cover_url` text,
	`owner_name` text,
	`track_count` integer DEFAULT 0 NOT NULL,
	`library_added_at` text,
	`remote_updated_at` text,
	`last_synced_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connector_id`) REFERENCES `connectors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `music_collections_user_provider_external_idx` ON `music_collections` (`user_id`,`provider`,`external_id`);--> statement-breakpoint
CREATE TABLE `music_tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`media_key` text NOT NULL,
	`title` text NOT NULL,
	`artists_json` text DEFAULT '[]' NOT NULL,
	`album_title` text,
	`album_external_id` text,
	`cover_url` text,
	`duration_ms` integer,
	`isrcs_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `music_tracks_provider_external_idx` ON `music_tracks` (`provider`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `music_tracks_media_key_idx` ON `music_tracks` (`media_key`);--> statement-breakpoint
ALTER TABLE `connectors` ADD `display_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `connectors` ADD `avatar_url` text;--> statement-breakpoint
ALTER TABLE `connectors` ADD `settings_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `connectors` ADD `credentials_encrypted` text;--> statement-breakpoint
ALTER TABLE `connectors` ADD `status` text DEFAULT 'connected' NOT NULL;