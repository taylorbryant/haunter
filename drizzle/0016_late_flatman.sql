ALTER TABLE `user` ADD `access_status` text DEFAULT 'waitlisted' NOT NULL;--> statement-breakpoint
UPDATE `user` SET `access_status` = 'approved';--> statement-breakpoint
DROP TABLE `waitlist_entries`;
