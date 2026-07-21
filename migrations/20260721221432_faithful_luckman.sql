PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP TABLE `connector_login_attempts`;--> statement-breakpoint
ALTER TABLE `__new_connector_login_attempts` RENAME TO `connector_login_attempts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
