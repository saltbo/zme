ALTER TABLE `manual_download_tasks` ADD `downstream_status` text;--> statement-breakpoint
ALTER TABLE `manual_download_tasks` ADD `downloaded_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `manual_download_tasks` ADD `storage_uploaded_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `manual_download_tasks` ADD `total_bytes` integer;--> statement-breakpoint
ALTER TABLE `manual_download_tasks` ADD `download_bps` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `manual_download_tasks` ADD `storage_upload_bps` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `manual_download_tasks` ADD `result_object_id` text;--> statement-breakpoint
ALTER TABLE `manual_download_tasks` ADD `result_name` text;--> statement-breakpoint
ALTER TABLE `manual_download_tasks` ADD `result_target_folder` text;--> statement-breakpoint
UPDATE `manual_download_tasks` SET `completed_at` = NULL WHERE `status` = 'submitted';
