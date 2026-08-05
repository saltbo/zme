ALTER TABLE `download_records` RENAME TO `download_dispatch_records`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_download_dispatch_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`resource_kind` text NOT NULL,
	`resource_key` text NOT NULL,
	`lane_key` text NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`downloader_id` text,
	`config_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`external_task_id` text,
	`first_accepted_at` text,
	`last_accepted_at` text,
	`manual_requested_at` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`downloader_id`) REFERENCES `downloaders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_download_dispatch_records`("id", "user_id", "resource_kind", "resource_key", "lane_key", "generation", "downloader_id", "config_json", "status", "attempt_count", "external_task_id", "first_accepted_at", "last_accepted_at", "manual_requested_at", "error_message", "created_at", "updated_at") SELECT "id", "user_id", "resource_kind", "resource_key", "lane_key", "generation", "downloader_id", "config_json", "status", "attempt_count", "external_task_id", "first_accepted_at", "last_accepted_at", "manual_requested_at", "error_message", "created_at", "updated_at" FROM `download_dispatch_records`;--> statement-breakpoint
DROP TABLE `download_dispatch_records`;--> statement-breakpoint
ALTER TABLE `__new_download_dispatch_records` RENAME TO `download_dispatch_records`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `download_records_user_resource_idx` ON `download_dispatch_records` (`user_id`,`resource_kind`,`resource_key`);--> statement-breakpoint
CREATE INDEX `download_records_status_idx` ON `download_dispatch_records` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `__new_subscription_download_records` (
	`subscription_id` text NOT NULL,
	`download_record_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `media_subscriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`download_record_id`) REFERENCES `download_dispatch_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_subscription_download_records`("subscription_id", "download_record_id", "created_at") SELECT "subscription_id", "download_record_id", "created_at" FROM `subscription_download_records`;--> statement-breakpoint
DROP TABLE `subscription_download_records`;--> statement-breakpoint
ALTER TABLE `__new_subscription_download_records` RENAME TO `subscription_download_records`;--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_download_records_pair_idx` ON `subscription_download_records` (`subscription_id`,`download_record_id`);--> statement-breakpoint
CREATE INDEX `subscription_download_records_record_idx` ON `subscription_download_records` (`download_record_id`);