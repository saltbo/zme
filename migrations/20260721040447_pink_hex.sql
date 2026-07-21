CREATE TABLE `dispatch_lanes` (
	`key` text PRIMARY KEY NOT NULL,
	`lease_owner` text,
	`lease_expires_at` text,
	`next_allowed_at` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `download_records` (
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
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`downloader_id`) REFERENCES `downloaders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `download_records_user_resource_idx` ON `download_records` (`user_id`,`resource_kind`,`resource_key`);--> statement-breakpoint
CREATE INDEX `download_records_status_idx` ON `download_records` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `media_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_key` text NOT NULL,
	`downloader_id` text,
	`config_json` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_evaluated_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`downloader_id`) REFERENCES `downloaders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_subscriptions_user_subject_idx` ON `media_subscriptions` (`user_id`,`subject_type`,`subject_key`);--> statement-breakpoint
CREATE TABLE `subscription_download_records` (
	`subscription_id` text NOT NULL,
	`download_record_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `media_subscriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`download_record_id`) REFERENCES `download_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_download_records_pair_idx` ON `subscription_download_records` (`subscription_id`,`download_record_id`);--> statement-breakpoint
CREATE INDEX `subscription_download_records_record_idx` ON `subscription_download_records` (`download_record_id`);--> statement-breakpoint
ALTER TABLE `music_download_keys` ADD `resource_encrypted` text;
--> statement-breakpoint
INSERT OR IGNORE INTO `download_records` (
	`id`,
	`user_id`,
	`resource_kind`,
	`resource_key`,
	`lane_key`,
	`generation`,
	`downloader_id`,
	`config_json`,
	`status`,
	`attempt_count`,
	`external_task_id`,
	`first_accepted_at`,
	`last_accepted_at`,
	`manual_requested_at`,
	`error_message`,
	`created_at`,
	`updated_at`
)
SELECT
	'legacy-music-' || lower(hex(randomblob(16))),
	`music_download_keys`.`user_id`,
	'music_track',
	`music_tracks`.`media_key`,
	'netease:' || `music_download_keys`.`connector_id`,
	1,
	`music_download_keys`.`downloader_id`,
	'{"preferredQuality":"' || `music_download_keys`.`quality` || '","resolvedQuality":"' || `music_download_keys`.`quality` || '"}',
	'accepted',
	0,
	NULL,
	`music_download_keys`.`created_at`,
	`music_download_keys`.`created_at`,
	`music_download_keys`.`created_at`,
	NULL,
	`music_download_keys`.`created_at`,
	`music_download_keys`.`created_at`
FROM `music_download_keys`
INNER JOIN `music_tracks` ON `music_tracks`.`id` = `music_download_keys`.`track_id`
WHERE `music_download_keys`.`revoked_at` IS NULL
ORDER BY `music_download_keys`.`created_at` ASC;
