PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE UNIQUE INDEX `connectors_id_user_idx` ON `connectors` (`id`,`user_id`);--> statement-breakpoint
CREATE TABLE `__new_connector_sync_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`status` text NOT NULL,
	`result_json` text,
	`error` text,
	`lease_owner` text,
	`lease_expires_at` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connector_id`,`user_id`) REFERENCES `connectors`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_connector_sync_jobs`("id", "user_id", "connector_id", "idempotency_key", "request_hash", "status", "result_json", "error", "lease_owner", "lease_expires_at", "created_at", "started_at", "completed_at") SELECT "id", "user_id", "connector_id", 'legacy:' || "id", 'legacy:' || "id", "status", "result_json", "error", NULL, NULL, "created_at", "started_at", "completed_at" FROM `connector_sync_jobs`;--> statement-breakpoint
DROP TABLE `connector_sync_jobs`;--> statement-breakpoint
ALTER TABLE `__new_connector_sync_jobs` RENAME TO `connector_sync_jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `connector_sync_jobs_user_created_idx` ON `connector_sync_jobs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `connector_sync_jobs_user_idempotency_idx` ON `connector_sync_jobs` (`user_id`,`idempotency_key`);
