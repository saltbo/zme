CREATE TABLE `__backup_release_search_results` AS SELECT * FROM `release_search_results`;--> statement-breakpoint
CREATE TABLE `__backup_manual_download_tasks` AS SELECT * FROM `manual_download_tasks`;--> statement-breakpoint
CREATE TABLE `__backup_music_collections` AS SELECT * FROM `music_collections`;--> statement-breakpoint
CREATE TABLE `__backup_music_collection_tracks` AS SELECT * FROM `music_collection_tracks`;--> statement-breakpoint
CREATE TABLE `__backup_music_track_availability` AS SELECT * FROM `music_track_availability`;--> statement-breakpoint
CREATE TABLE `__backup_music_download_keys` AS SELECT * FROM `music_download_keys`;--> statement-breakpoint
CREATE TABLE `__backup_media_subscriptions` AS SELECT * FROM `media_subscriptions`;--> statement-breakpoint
CREATE TABLE `__backup_download_records` AS SELECT * FROM `download_records`;--> statement-breakpoint
CREATE TABLE `__backup_subscription_download_records` AS SELECT * FROM `subscription_download_records`;--> statement-breakpoint
DELETE FROM `manual_download_tasks`;--> statement-breakpoint
ALTER TABLE `user` RENAME TO `__legacy_users`;--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`oidc_email` text,
	`image` text,
	`role` text DEFAULT 'user',
	`disabled` integer DEFAULT false NOT NULL,
	`issuer` text,
	`subject` text,
	`identity_bound_at` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);--> statement-breakpoint
INSERT INTO `users`("id", "name", "oidc_email", "image", "role", "disabled", "issuer", "subject", "identity_bound_at", "created_at", "updated_at") SELECT "id", "name", "oidc_email", "image", "role", "disabled", "issuer", "subject", "identity_bound_at", "created_at", "updated_at" FROM `__legacy_users`;--> statement-breakpoint
DROP TABLE `account`;--> statement-breakpoint
DROP TABLE `session`;--> statement-breakpoint
DROP TABLE `verification`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_issuer_subject_idx` ON `users` (`issuer`,`subject`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_application_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_application_sessions`("id", "token_hash", "user_id", "expires_at", "created_at", "last_seen_at") SELECT "id", "token_hash", "user_id", "expires_at", "created_at", "last_seen_at" FROM `application_sessions`;--> statement-breakpoint
DROP TABLE `application_sessions`;--> statement-breakpoint
ALTER TABLE `__new_application_sessions` RENAME TO `application_sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `application_sessions_token_hash_unique` ON `application_sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `__new_connector_login_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`method` text NOT NULL,
	`state_encrypted` text,
	`challenge_json` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_connector_login_attempts`("id", "user_id", "kind", "method", "state_encrypted", "challenge_json", "status", "expires_at", "created_at", "updated_at") SELECT "id", "user_id", "kind", "method", "state_encrypted", "challenge_json", "status", "expires_at", "created_at", "updated_at" FROM `connector_login_attempts`;--> statement-breakpoint
DROP TABLE `connector_login_attempts`;--> statement-breakpoint
ALTER TABLE `__new_connector_login_attempts` RENAME TO `connector_login_attempts`;--> statement-breakpoint
CREATE TABLE `__new_connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`external_account_id` text NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`avatar_url` text,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`credentials_encrypted` text,
	`status` text DEFAULT 'connected' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_synced_at` text,
	`last_error` text,
	`last_result_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_connectors`("id", "user_id", "kind", "external_account_id", "display_name", "avatar_url", "settings_json", "credentials_encrypted", "status", "enabled", "last_synced_at", "last_error", "last_result_json", "created_at", "updated_at") SELECT "id", "user_id", "kind", "external_account_id", "display_name", "avatar_url", "settings_json", "credentials_encrypted", "status", "enabled", "last_synced_at", "last_error", "last_result_json", "created_at", "updated_at" FROM `connectors`;--> statement-breakpoint
DROP TABLE `connectors`;--> statement-breakpoint
ALTER TABLE `__new_connectors` RENAME TO `connectors`;--> statement-breakpoint
CREATE UNIQUE INDEX `connectors_user_kind_idx` ON `connectors` (`user_id`,`kind`);--> statement-breakpoint
CREATE TABLE `__new_download_records` (
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
INSERT INTO `__new_download_records`("id", "user_id", "resource_kind", "resource_key", "lane_key", "generation", "downloader_id", "config_json", "status", "attempt_count", "external_task_id", "first_accepted_at", "last_accepted_at", "manual_requested_at", "error_message", "created_at", "updated_at") SELECT "id", "user_id", "resource_kind", "resource_key", "lane_key", "generation", "downloader_id", "config_json", "status", "attempt_count", "external_task_id", "first_accepted_at", "last_accepted_at", "manual_requested_at", "error_message", "created_at", "updated_at" FROM `download_records`;--> statement-breakpoint
DROP TABLE `download_records`;--> statement-breakpoint
ALTER TABLE `__new_download_records` RENAME TO `download_records`;--> statement-breakpoint
CREATE UNIQUE INDEX `download_records_user_resource_idx` ON `download_records` (`user_id`,`resource_kind`,`resource_key`);--> statement-breakpoint
CREATE INDEX `download_records_status_idx` ON `download_records` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `__new_downloaders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`description` text,
	`kind` text NOT NULL,
	`endpoint` text NOT NULL,
	`credentials_json` text DEFAULT '{}' NOT NULL,
	`options_json` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`health_status` text DEFAULT 'unknown' NOT NULL,
	`health_message` text,
	`health_checked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_downloaders`("id", "user_id", "description", "kind", "endpoint", "credentials_json", "options_json", "enabled", "health_status", "health_message", "health_checked_at", "created_at", "updated_at") SELECT "id", "user_id", "description", "kind", "endpoint", "credentials_json", "options_json", "enabled", "health_status", "health_message", "health_checked_at", "created_at", "updated_at" FROM `downloaders`;--> statement-breakpoint
DROP TABLE `downloaders`;--> statement-breakpoint
ALTER TABLE `__new_downloaders` RENAME TO `downloaders`;--> statement-breakpoint
CREATE TABLE `__new_library` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`media_key` text NOT NULL,
	`kind` text NOT NULL,
	`tmdb_id` integer,
	`saved_at` text,
	`watched_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_library`("id", "user_id", "media_key", "kind", "tmdb_id", "saved_at", "watched_at", "created_at", "updated_at") SELECT "id", "user_id", "media_key", "kind", "tmdb_id", "saved_at", "watched_at", "created_at", "updated_at" FROM `library`;--> statement-breakpoint
DROP TABLE `library`;--> statement-breakpoint
ALTER TABLE `__new_library` RENAME TO `library`;--> statement-breakpoint
CREATE UNIQUE INDEX `library_user_media_key_idx` ON `library` (`user_id`,`media_key`);--> statement-breakpoint
CREATE TABLE `__new_manual_download_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`release_search_result_id` text NOT NULL,
	`downloader_id` text NOT NULL,
	`status` text NOT NULL,
	`external_task_id` text,
	`error` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`release_search_result_id`) REFERENCES `release_search_results`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`downloader_id`) REFERENCES `downloaders`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_manual_download_tasks`("id", "user_id", "idempotency_key", "request_hash", "release_search_result_id", "downloader_id", "status", "external_task_id", "error", "created_at", "completed_at") SELECT "id", "user_id", "idempotency_key", "request_hash", "release_search_result_id", "downloader_id", "status", "external_task_id", "error", "created_at", "completed_at" FROM `manual_download_tasks`;--> statement-breakpoint
DROP TABLE `manual_download_tasks`;--> statement-breakpoint
ALTER TABLE `__new_manual_download_tasks` RENAME TO `manual_download_tasks`;--> statement-breakpoint
CREATE UNIQUE INDEX `manual_download_tasks_user_idempotency_idx` ON `manual_download_tasks` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `__new_media_subscriptions` (
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
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`downloader_id`) REFERENCES `downloaders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_media_subscriptions`("id", "user_id", "subject_type", "subject_key", "downloader_id", "config_json", "enabled", "last_evaluated_at", "created_at", "updated_at") SELECT "id", "user_id", "subject_type", "subject_key", "downloader_id", "config_json", "enabled", "last_evaluated_at", "created_at", "updated_at" FROM `media_subscriptions`;--> statement-breakpoint
DROP TABLE `media_subscriptions`;--> statement-breakpoint
ALTER TABLE `__new_media_subscriptions` RENAME TO `media_subscriptions`;--> statement-breakpoint
CREATE UNIQUE INDEX `media_subscriptions_user_subject_idx` ON `media_subscriptions` (`user_id`,`subject_type`,`subject_key`);--> statement-breakpoint
CREATE TABLE `__new_music_collections` (
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
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connector_id`) REFERENCES `connectors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_music_collections`("id", "user_id", "connector_id", "kind", "provider", "external_id", "title", "description", "cover_url", "owner_name", "track_count", "library_added_at", "remote_updated_at", "last_synced_at", "created_at", "updated_at") SELECT "id", "user_id", "connector_id", "kind", "provider", "external_id", "title", "description", "cover_url", "owner_name", "track_count", "library_added_at", "remote_updated_at", "last_synced_at", "created_at", "updated_at" FROM `music_collections`;--> statement-breakpoint
DROP TABLE `music_collections`;--> statement-breakpoint
ALTER TABLE `__new_music_collections` RENAME TO `music_collections`;--> statement-breakpoint
CREATE UNIQUE INDEX `music_collections_user_provider_external_idx` ON `music_collections` (`user_id`,`provider`,`external_id`);--> statement-breakpoint
CREATE TABLE `__new_music_download_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`key_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`track_id` text NOT NULL,
	`downloader_id` text NOT NULL,
	`quality` text NOT NULL,
	`resource_encrypted` text,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connector_id`) REFERENCES `connectors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `music_tracks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`downloader_id`) REFERENCES `downloaders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_music_download_keys`("id", "key_hash", "user_id", "connector_id", "track_id", "downloader_id", "quality", "resource_encrypted", "expires_at", "revoked_at", "created_at") SELECT "id", "key_hash", "user_id", "connector_id", "track_id", "downloader_id", "quality", "resource_encrypted", "expires_at", "revoked_at", "created_at" FROM `music_download_keys`;--> statement-breakpoint
DROP TABLE `music_download_keys`;--> statement-breakpoint
ALTER TABLE `__new_music_download_keys` RENAME TO `music_download_keys`;--> statement-breakpoint
CREATE UNIQUE INDEX `music_download_keys_key_hash_idx` ON `music_download_keys` (`key_hash`);--> statement-breakpoint
CREATE TABLE `__new_music_track_availability` (
	`user_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`track_id` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`provider_code` text,
	`provider_details_json` text DEFAULT '{}' NOT NULL,
	`checked_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connector_id`) REFERENCES `connectors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `music_tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_music_track_availability`("user_id", "connector_id", "track_id", "status", "reason", "provider_code", "provider_details_json", "checked_at", "updated_at") SELECT "user_id", "connector_id", "track_id", "status", "reason", "provider_code", "provider_details_json", "checked_at", "updated_at" FROM `music_track_availability`;--> statement-breakpoint
DROP TABLE `music_track_availability`;--> statement-breakpoint
ALTER TABLE `__new_music_track_availability` RENAME TO `music_track_availability`;--> statement-breakpoint
CREATE UNIQUE INDEX `music_track_availability_connector_track_idx` ON `music_track_availability` (`connector_id`,`track_id`);--> statement-breakpoint
CREATE INDEX `music_track_availability_connector_checked_idx` ON `music_track_availability` (`connector_id`,`checked_at`);--> statement-breakpoint
CREATE TABLE `__new_release_search_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`media_key` text NOT NULL,
	`media_title` text NOT NULL,
	`query` text NOT NULL,
	`search_type` text NOT NULL,
	`categories_json` text DEFAULT '[]' NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_release_search_jobs`("id", "user_id", "idempotency_key", "request_hash", "media_key", "media_title", "query", "search_type", "categories_json", "status", "error", "created_at", "completed_at") SELECT "id", "user_id", "idempotency_key", "request_hash", "media_key", "media_title", "query", "search_type", "categories_json", "status", "error", "created_at", "completed_at" FROM `release_search_jobs`;--> statement-breakpoint
DROP TABLE `release_search_jobs`;--> statement-breakpoint
ALTER TABLE `__new_release_search_jobs` RENAME TO `release_search_jobs`;--> statement-breakpoint
CREATE UNIQUE INDEX `release_search_jobs_user_idempotency_idx` ON `release_search_jobs` (`user_id`,`idempotency_key`);--> statement-breakpoint
INSERT OR REPLACE INTO `download_records` SELECT * FROM `__backup_download_records`;--> statement-breakpoint
INSERT OR REPLACE INTO `media_subscriptions` SELECT * FROM `__backup_media_subscriptions`;--> statement-breakpoint
INSERT OR REPLACE INTO `music_collections` SELECT * FROM `__backup_music_collections`;--> statement-breakpoint
INSERT OR REPLACE INTO `release_search_results` SELECT * FROM `__backup_release_search_results`;--> statement-breakpoint
INSERT OR REPLACE INTO `music_track_availability` SELECT * FROM `__backup_music_track_availability`;--> statement-breakpoint
INSERT OR REPLACE INTO `music_download_keys` (
	`id`, `key_hash`, `user_id`, `connector_id`, `track_id`, `downloader_id`, `quality`,
	`resource_encrypted`, `expires_at`, `revoked_at`, `created_at`
) SELECT
	`id`, `key_hash`, `user_id`, `connector_id`, `track_id`, `downloader_id`, `quality`,
	`resource_encrypted`, `expires_at`, `revoked_at`, `created_at`
FROM `__backup_music_download_keys`;--> statement-breakpoint
INSERT OR REPLACE INTO `music_collection_tracks` SELECT * FROM `__backup_music_collection_tracks`;--> statement-breakpoint
INSERT OR REPLACE INTO `subscription_download_records` SELECT * FROM `__backup_subscription_download_records`;--> statement-breakpoint
INSERT OR REPLACE INTO `manual_download_tasks` SELECT * FROM `__backup_manual_download_tasks`;--> statement-breakpoint
DROP TABLE `__backup_release_search_results`;--> statement-breakpoint
DROP TABLE `__backup_manual_download_tasks`;--> statement-breakpoint
DROP TABLE `__backup_music_collection_tracks`;--> statement-breakpoint
DROP TABLE `__backup_music_track_availability`;--> statement-breakpoint
DROP TABLE `__backup_music_download_keys`;--> statement-breakpoint
DROP TABLE `__backup_music_collections`;--> statement-breakpoint
DROP TABLE `__backup_subscription_download_records`;--> statement-breakpoint
DROP TABLE `__backup_media_subscriptions`;--> statement-breakpoint
DROP TABLE `__backup_download_records`;--> statement-breakpoint
DROP TABLE `__legacy_users`;
