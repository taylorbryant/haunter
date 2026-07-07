ALTER TABLE `pages` ADD `search_text` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `pages_workspace_deleted_position_idx` ON `pages` (`workspace_id`,`deleted_at`,`position`);--> statement-breakpoint
CREATE INDEX `tasks_assignee_idx` ON `tasks` (`workspace_id`,`assignee_id`,`completed`);