ALTER TABLE `notification_preferences` ADD `task_reminders_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `reminder_offset_minutes` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `reminder_configured_at` text;--> statement-breakpoint
CREATE INDEX `tasks_reminder_candidate_idx` ON `tasks` (`completed`,`reminder_offset_minutes`,`due_date`,`assignee_id`);