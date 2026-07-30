ALTER TABLE `notifications` ADD `action_state` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `action_at` text;--> statement-breakpoint
ALTER TABLE `notifications` ADD `snoozed_until` text;--> statement-breakpoint
CREATE INDEX `notifications_snoozed_idx` ON `notifications` (`action_state`,`snoozed_until`);