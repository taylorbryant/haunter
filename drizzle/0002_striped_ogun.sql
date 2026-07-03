CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`page_id` text,
	`source_block_id` text,
	`title` text NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`due_date` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_page_block_idx` ON `tasks` (`page_id`,`source_block_id`) WHERE source_block_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `tasks_workspace_idx` ON `tasks` (`workspace_id`,`completed`);--> statement-breakpoint
CREATE INDEX `tasks_user_idx` ON `tasks` (`user_id`);