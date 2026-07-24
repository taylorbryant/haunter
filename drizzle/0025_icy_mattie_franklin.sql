CREATE TABLE `page_user_state` (
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`page_id` text NOT NULL,
	`favorited_at` text,
	`last_viewed_at` text,
	PRIMARY KEY(`user_id`, `page_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`user_id`) REFERENCES `member`(`organization_id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `page_user_state_favorites_idx` ON `page_user_state` (`workspace_id`,`user_id`,`favorited_at`);--> statement-breakpoint
CREATE INDEX `page_user_state_recents_idx` ON `page_user_state` (`workspace_id`,`user_id`,`last_viewed_at`);