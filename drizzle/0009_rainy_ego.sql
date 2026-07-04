DROP TABLE `workspaces`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_canvases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`page_id` text NOT NULL,
	`snapshot` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_canvases`("id", "user_id", "workspace_id", "page_id", "snapshot", "created_at", "updated_at") SELECT "id", "user_id", "workspace_id", "page_id", "snapshot", "created_at", "updated_at" FROM `canvases`;--> statement-breakpoint
DROP TABLE `canvases`;--> statement-breakpoint
ALTER TABLE `__new_canvases` RENAME TO `canvases`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `canvases_page_idx` ON `canvases` (`page_id`);--> statement-breakpoint
CREATE TABLE `__new_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`parent_page_id` text,
	`title` text NOT NULL,
	`icon` text,
	`position` real NOT NULL,
	`content` text DEFAULT '[]' NOT NULL,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_pages`("id", "user_id", "workspace_id", "parent_page_id", "title", "icon", "position", "content", "deleted_at", "created_at", "updated_at") SELECT "id", "user_id", "workspace_id", "parent_page_id", "title", "icon", "position", "content", "deleted_at", "created_at", "updated_at" FROM `pages`;--> statement-breakpoint
DROP TABLE `pages`;--> statement-breakpoint
ALTER TABLE `__new_pages` RENAME TO `pages`;--> statement-breakpoint
CREATE INDEX `pages_workspace_idx` ON `pages` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `pages_parent_idx` ON `pages` (`parent_page_id`);--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`assignee_id` text,
	`page_id` text,
	`source_block_id` text,
	`title` text NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`due_date` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "user_id", "workspace_id", "assignee_id", "page_id", "source_block_id", "title", "completed", "due_date", "completed_at", "created_at", "updated_at") SELECT "id", "user_id", "workspace_id", "assignee_id", "page_id", "source_block_id", "title", "completed", "due_date", "completed_at", "created_at", "updated_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_page_block_idx` ON `tasks` (`page_id`,`source_block_id`) WHERE source_block_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `tasks_workspace_idx` ON `tasks` (`workspace_id`,`completed`);--> statement-breakpoint
CREATE INDEX `tasks_user_idx` ON `tasks` (`user_id`);