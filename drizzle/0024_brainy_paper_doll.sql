PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`parent_page_id` text,
	`title` text NOT NULL,
	`icon` text,
	`position` real NOT NULL,
	`content` text DEFAULT '[]' NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`content_updated_at` text NOT NULL,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_pages`("id", "user_id", "workspace_id", "parent_page_id", "title", "icon", "position", "content", "search_text", "content_updated_at", "deleted_at", "created_at", "updated_at") SELECT "id", "user_id", "workspace_id", "parent_page_id", "title", "icon", "position", "content", "search_text", "updated_at", "deleted_at", "created_at", "updated_at" FROM `pages`;--> statement-breakpoint
DROP TABLE `pages`;--> statement-breakpoint
ALTER TABLE `__new_pages` RENAME TO `pages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `pages_workspace_idx` ON `pages` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `pages_workspace_deleted_position_idx` ON `pages` (`workspace_id`,`deleted_at`,`position`);--> statement-breakpoint
CREATE INDEX `pages_workspace_deleted_updated_idx` ON `pages` (`workspace_id`,`deleted_at`,`updated_at`);--> statement-breakpoint
CREATE INDEX `pages_parent_idx` ON `pages` (`parent_page_id`);
