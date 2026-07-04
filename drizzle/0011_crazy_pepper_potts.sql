CREATE TABLE `page_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`token` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_shares_token_unique` ON `page_shares` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `page_shares_page_idx` ON `page_shares` (`page_id`);