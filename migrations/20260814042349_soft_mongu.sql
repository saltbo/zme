CREATE TABLE `release_candidate_snapshots` (
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`media_key` text NOT NULL,
	`item_json` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `release_candidate_snapshots_user_id_idx` ON `release_candidate_snapshots` (`user_id`,`id`);--> statement-breakpoint
CREATE INDEX `release_candidate_snapshots_expires_idx` ON `release_candidate_snapshots` (`expires_at`);