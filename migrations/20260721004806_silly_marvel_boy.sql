CREATE TABLE `music_download_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`key_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`track_id` text NOT NULL,
	`downloader_id` text NOT NULL,
	`quality` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connector_id`) REFERENCES `connectors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `music_tracks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`downloader_id`) REFERENCES `downloaders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `music_download_keys_key_hash_idx` ON `music_download_keys` (`key_hash`);