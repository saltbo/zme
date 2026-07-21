CREATE TABLE `music_release_tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`release_id` text NOT NULL,
	`track_id` text NOT NULL,
	`disc_number` integer,
	`track_number` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `music_releases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `music_tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `music_release_tracks_release_track_idx` ON `music_release_tracks` (`release_id`,`track_id`);--> statement-breakpoint
CREATE TABLE `music_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`artists_json` text DEFAULT '[]' NOT NULL,
	`release_date` text,
	`release_type` text DEFAULT 'unknown' NOT NULL,
	`provider_release_type` text,
	`cover_url` text,
	`metadata_updated_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `music_releases_provider_external_idx` ON `music_releases` (`provider`,`external_id`);--> statement-breakpoint
ALTER TABLE `music_collection_tracks` ADD `release_track_id` text REFERENCES music_release_tracks(id);--> statement-breakpoint
INSERT INTO `music_releases` (
	`id`,
	`provider`,
	`external_id`,
	`title`,
	`artists_json`,
	`release_date`,
	`release_type`,
	`provider_release_type`,
	`cover_url`,
	`metadata_updated_at`,
	`created_at`,
	`updated_at`
)
SELECT
	lower(hex(randomblob(16))),
	`provider`,
	`album_external_id`,
	coalesce(max(nullif(`album_title`, '')), 'Unknown Release'),
	coalesce(max(nullif(`album_artists_json`, '')), '[]'),
	max(`album_release_date`),
	CASE lower(trim(coalesce(max(`album_release_type`), '')))
		WHEN 'album' THEN 'album'
		WHEN '专辑' THEN 'album'
		WHEN 'single' THEN 'single'
		WHEN '单曲' THEN 'single'
		WHEN 'ep' THEN 'ep'
		WHEN 'compilation' THEN 'compilation'
		WHEN '精选集' THEN 'compilation'
		WHEN 'soundtrack' THEN 'soundtrack'
		WHEN '原声' THEN 'soundtrack'
		WHEN 'live' THEN 'live'
		WHEN '现场' THEN 'live'
		WHEN 'broadcast' THEN 'broadcast'
		WHEN '广播' THEN 'broadcast'
		WHEN '' THEN 'unknown'
		ELSE 'other'
	END,
	max(`album_release_type`),
	max(`cover_url`),
	max(coalesce(`album_metadata_updated_at`, `updated_at`)),
	min(`created_at`),
	max(`updated_at`)
FROM `music_tracks`
WHERE `album_external_id` IS NOT NULL
GROUP BY `provider`, `album_external_id`;--> statement-breakpoint
INSERT INTO `music_release_tracks` (
	`id`, `release_id`, `track_id`, `disc_number`, `track_number`, `created_at`, `updated_at`
)
SELECT
	lower(hex(randomblob(16))),
	`music_releases`.`id`,
	`music_tracks`.`id`,
	`music_tracks`.`disc_number`,
	`music_tracks`.`track_number`,
	`music_tracks`.`created_at`,
	`music_tracks`.`updated_at`
FROM `music_tracks`
INNER JOIN `music_releases`
	ON `music_releases`.`provider` = `music_tracks`.`provider`
	AND `music_releases`.`external_id` = `music_tracks`.`album_external_id`;--> statement-breakpoint
UPDATE `music_collection_tracks`
SET `release_track_id` = (
	SELECT `music_release_tracks`.`id`
	FROM `music_release_tracks`
	WHERE `music_release_tracks`.`track_id` = `music_collection_tracks`.`track_id`
	LIMIT 1
);--> statement-breakpoint
UPDATE `download_records`
SET `lane_key` = 'music:' || substr(`lane_key`, length('netease:') + 1)
WHERE `lane_key` LIKE 'netease:%';--> statement-breakpoint
INSERT OR IGNORE INTO `dispatch_lanes` (`key`, `lease_owner`, `lease_expires_at`, `next_allowed_at`, `updated_at`)
SELECT
	'music:' || substr(`key`, length('netease:') + 1),
	NULL,
	NULL,
	`next_allowed_at`,
	`updated_at`
FROM `dispatch_lanes`
WHERE `key` LIKE 'netease:%';--> statement-breakpoint
DELETE FROM `dispatch_lanes` WHERE `key` LIKE 'netease:%';--> statement-breakpoint
ALTER TABLE `music_tracks` DROP COLUMN `album_title`;--> statement-breakpoint
ALTER TABLE `music_tracks` DROP COLUMN `album_external_id`;--> statement-breakpoint
ALTER TABLE `music_tracks` DROP COLUMN `album_artists_json`;--> statement-breakpoint
ALTER TABLE `music_tracks` DROP COLUMN `album_release_date`;--> statement-breakpoint
ALTER TABLE `music_tracks` DROP COLUMN `album_release_type`;--> statement-breakpoint
ALTER TABLE `music_tracks` DROP COLUMN `album_metadata_updated_at`;--> statement-breakpoint
ALTER TABLE `music_tracks` DROP COLUMN `disc_number`;--> statement-breakpoint
ALTER TABLE `music_tracks` DROP COLUMN `track_number`;
