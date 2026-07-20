ALTER TABLE `library_sources` RENAME TO `connectors`;--> statement-breakpoint
ALTER TABLE `connectors` RENAME COLUMN "source" TO "kind";--> statement-breakpoint
ALTER TABLE `connectors` RENAME COLUMN "profile_id" TO "external_account_id";--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`external_account_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_synced_at` text,
	`last_error` text,
	`last_result_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_connectors`("id", "user_id", "kind", "external_account_id", "enabled", "last_synced_at", "last_error", "last_result_json", "created_at", "updated_at") SELECT "id", "user_id", "kind", "external_account_id", "enabled", "last_synced_at", "last_error", "last_result_json", "created_at", "updated_at" FROM `connectors`;--> statement-breakpoint
DROP TABLE `connectors`;--> statement-breakpoint
ALTER TABLE `__new_connectors` RENAME TO `connectors`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `connectors_user_kind_idx` ON `connectors` (`user_id`,`kind`);