ALTER TABLE `manual_download_tasks` ADD `downstream_revision` text;--> statement-breakpoint
ALTER TABLE `release_search_jobs` ADD `lease_owner` text;--> statement-breakpoint
ALTER TABLE `release_search_jobs` ADD `lease_expires_at` text;