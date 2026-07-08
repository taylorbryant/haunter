CREATE INDEX `pages_workspace_deleted_updated_idx` ON `pages` (`workspace_id`,`deleted_at`,`updated_at`);--> statement-breakpoint
CREATE INDEX `tasks_workspace_list_idx` ON `tasks` (`workspace_id`,`completed`,`due_date`,`created_at`);--> statement-breakpoint
CREATE INDEX `tasks_assignee_list_idx` ON `tasks` (`workspace_id`,`assignee_id`,`completed`,`due_date`,`created_at`);--> statement-breakpoint
CREATE INDEX `tasks_page_idx` ON `tasks` (`page_id`);