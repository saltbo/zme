CREATE TABLE `application_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_sessions_token_hash_unique` ON `application_sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `dpop_replays` (
	`issuer` text NOT NULL,
	`proof_jti` text NOT NULL,
	`key_thumbprint` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dpop_replays_issuer_jti_key_idx` ON `dpop_replays` (`issuer`,`proof_jti`,`key_thumbprint`);--> statement-breakpoint
CREATE TABLE `manual_download_tasks` (
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
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`release_search_result_id`) REFERENCES `release_search_results`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`downloader_id`) REFERENCES `downloaders`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `manual_download_tasks_user_idempotency_idx` ON `manual_download_tasks` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `oidc_login_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`state_hash` text NOT NULL,
	`nonce` text NOT NULL,
	`code_verifier` text NOT NULL,
	`return_to` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oidc_login_transactions_state_hash_unique` ON `oidc_login_transactions` (`state_hash`);--> statement-breakpoint
CREATE TABLE `release_search_jobs` (
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
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `release_search_jobs_user_idempotency_idx` ON `release_search_jobs` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `release_search_results` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`position` integer NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `release_search_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `release_search_results_job_position_idx` ON `release_search_results` (`job_id`,`position`);--> statement-breakpoint
ALTER TABLE `user` ADD `oidc_email` text;--> statement-breakpoint
ALTER TABLE `user` ADD `disabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `issuer` text;--> statement-breakpoint
ALTER TABLE `user` ADD `subject` text;--> statement-breakpoint
ALTER TABLE `user` ADD `identity_bound_at` text;