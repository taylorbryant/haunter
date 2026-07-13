DROP INDEX `tasks_workspace_list_idx`;--> statement-breakpoint
DROP INDEX `tasks_assignee_list_idx`;--> statement-breakpoint
DROP INDEX `tasks_overdue_notification_idx`;--> statement-breakpoint
ALTER TABLE `tasks` ADD `due_time` text;--> statement-breakpoint
CREATE INDEX `tasks_workspace_list_idx` ON `tasks` (`workspace_id`,`completed`,`due_date`,`due_time`,`created_at`);--> statement-breakpoint
CREATE INDEX `tasks_assignee_list_idx` ON `tasks` (`workspace_id`,`assignee_id`,`completed`,`due_date`,`due_time`,`created_at`);--> statement-breakpoint
CREATE INDEX `tasks_overdue_notification_idx` ON `tasks` (`completed`,`due_date`,`due_time`,`assignee_id`);