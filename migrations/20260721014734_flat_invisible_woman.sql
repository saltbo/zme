CREATE TABLE `music_track_availability` (
	`user_id` text NOT NULL,
	`track_id` text NOT NULL,
	`status` text NOT NULL,
	`checked_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `music_tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `music_track_availability_user_track_idx` ON `music_track_availability` (`user_id`,`track_id`);--> statement-breakpoint
CREATE INDEX `music_track_availability_user_checked_idx` ON `music_track_availability` (`user_id`,`checked_at`);