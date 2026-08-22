PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_canvases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`page_id` text,
	`title` text,
	`snapshot` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_canvases`("id", "user_id", "workspace_id", "page_id", "title", "snapshot", "created_at", "updated_at") SELECT "id", "user_id", "workspace_id", "page_id", NULL, "snapshot", "created_at", "updated_at" FROM `canvases`;--> statement-breakpoint
DROP TABLE `canvases`;--> statement-breakpoint
ALTER TABLE `__new_canvases` RENAME TO `canvases`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `canvases_page_idx` ON `canvases` (`page_id`);--> statement-breakpoint
CREATE INDEX `canvases_workspace_updated_idx` ON `canvases` (`workspace_id`,`updated_at`);
