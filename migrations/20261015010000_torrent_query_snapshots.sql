CREATE TABLE `torrent_query_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`query_signature` text NOT NULL,
	`items_json` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `torrent_query_snapshots_expires_idx` ON `torrent_query_snapshots` (`expires_at`);