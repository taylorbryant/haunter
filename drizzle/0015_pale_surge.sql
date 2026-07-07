CREATE TABLE `waitlist_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_requested_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `waitlist_entries_email_unique` ON `waitlist_entries` (`email`);