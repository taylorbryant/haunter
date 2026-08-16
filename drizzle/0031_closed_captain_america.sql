CREATE TABLE `inbox_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`page_id` text,
	`task_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`user_id`) REFERENCES `member`(`organization_id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "inbox_items_resource_check" CHECK(("inbox_items"."kind" = 'page' AND "inbox_items"."page_id" IS NOT NULL AND "inbox_items"."task_id" IS NULL) OR ("inbox_items"."kind" = 'task' AND "inbox_items"."task_id" IS NOT NULL AND "inbox_items"."page_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_items_user_page_idx` ON `inbox_items` (`user_id`,`page_id`) WHERE "inbox_items"."page_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_items_user_task_idx` ON `inbox_items` (`user_id`,`task_id`) WHERE "inbox_items"."task_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `inbox_items_user_list_idx` ON `inbox_items` (`workspace_id`,`user_id`,`created_at`);