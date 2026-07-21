DROP TABLE `music_track_availability`;--> statement-breakpoint
CREATE TABLE `music_track_availability` (
	`user_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`track_id` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`provider_code` text,
	`provider_details_json` text DEFAULT '{}' NOT NULL,
	`checked_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connector_id`) REFERENCES `connectors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `music_tracks`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `music_track_availability_connector_track_idx` ON `music_track_availability` (`connector_id`,`track_id`);--> statement-breakpoint
CREATE INDEX `music_track_availability_connector_checked_idx` ON `music_track_availability` (`connector_id`,`checked_at`);
