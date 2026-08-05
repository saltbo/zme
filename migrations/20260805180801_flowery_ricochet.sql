CREATE TABLE `downloads` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`resource_ref` text NOT NULL,
	`resource_kind` text NOT NULL,
	`resource_key` text NOT NULL,
	`downloader_id` text NOT NULL,
	`spec_json` text NOT NULL,
	`status` text NOT NULL,
	`stage` text,
	`external_task_id` text,
	`downstream_status` text,
	`downstream_revision` text,
	`downloaded_bytes` integer DEFAULT 0 NOT NULL,
	`storage_uploaded_bytes` integer DEFAULT 0 NOT NULL,
	`total_bytes` integer,
	`download_bps` integer DEFAULT 0 NOT NULL,
	`storage_upload_bps` integer DEFAULT 0 NOT NULL,
	`result_object_id` text,
	`result_name` text,
	`result_target_folder` text,
	`error` text,
	`suspension_created_at` text,
	`cancellation_created_at` text,
	`legacy_download_record_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`downloader_id`) REFERENCES `downloaders`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `downloads_user_idempotency_idx` ON `downloads` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `downloads_user_created_idx` ON `downloads` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `downloads_status_updated_idx` ON `downloads` (`status`,`updated_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO `downloads` (
  `id`, `user_id`, `idempotency_key`, `request_hash`, `resource_ref`, `resource_kind`,
  `resource_key`, `downloader_id`, `spec_json`, `status`, `external_task_id`,
  `downstream_status`, `downstream_revision`, `downloaded_bytes`, `storage_uploaded_bytes`,
  `total_bytes`, `download_bps`, `storage_upload_bps`, `result_object_id`, `result_name`,
  `result_target_folder`, `error`, `created_at`, `updated_at`, `completed_at`
)
SELECT
  task.id,
  task.user_id,
  task.idempotency_key,
  task.request_hash,
  'legacy-release:' || task.release_search_result_id,
  'release',
  job.media_key,
  task.downloader_id,
  json_object(
    'sourceType', CASE WHEN json_extract(result.payload_json, '$.magnetUrl') IS NOT NULL THEN 'magnet' ELSE 'torrent_url' END,
    'uri', COALESCE(json_extract(result.payload_json, '$.magnetUrl'), json_extract(result.payload_json, '$.downloadUrl')),
    'title', json_extract(result.payload_json, '$.title'),
    'category', CASE WHEN job.media_key LIKE 'tmdb:tv:%' THEN 'zme:series' ELSE 'zme:movie' END,
    'tags', json_array('mediaKey=' || job.media_key)
  ),
  task.status,
  task.external_task_id,
  task.downstream_status,
  task.downstream_revision,
  task.downloaded_bytes,
  task.storage_uploaded_bytes,
  task.total_bytes,
  task.download_bps,
  task.storage_upload_bps,
  task.result_object_id,
  task.result_name,
  task.result_target_folder,
  task.error,
  task.created_at,
  COALESCE(task.completed_at, task.created_at),
  task.completed_at
FROM `manual_download_tasks` task
JOIN `release_search_results` result ON result.id = task.release_search_result_id
JOIN `release_search_jobs` job ON job.id = result.job_id
WHERE COALESCE(json_extract(result.payload_json, '$.magnetUrl'), json_extract(result.payload_json, '$.downloadUrl')) IS NOT NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `downloads` (
  `id`, `user_id`, `idempotency_key`, `request_hash`, `resource_ref`, `resource_kind`,
  `resource_key`, `downloader_id`, `spec_json`, `status`, `external_task_id`,
  `error`, `legacy_download_record_id`, `created_at`, `updated_at`, `completed_at`
)
SELECT
  record.id,
  record.user_id,
  'migration:download-record:' || record.id,
  'migration:' || record.id,
  'music-track:' || record.resource_key,
  'music_track',
  record.resource_key,
  record.downloader_id,
  json_object(
    'sourceType', 'http',
    'uri', 'internal:music-track:' || record.resource_key,
    'category', 'zme:music',
    'tags', json_array('mediaKey=' || record.resource_key, 'kind=music')
  ),
  CASE record.status
    WHEN 'accepted' THEN 'submitted'
    WHEN 'waiting_source' THEN 'waitingSource'
    ELSE record.status
  END,
  record.external_task_id,
  record.error_message,
  record.id,
  record.created_at,
  record.updated_at,
  CASE WHEN record.status IN ('failed', 'canceled') THEN record.updated_at ELSE NULL END
FROM `download_records` record
WHERE record.downloader_id IS NOT NULL;
