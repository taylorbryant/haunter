CREATE TABLE `changelog_user_state` (
	`user_id` text PRIMARY KEY NOT NULL,
	`last_seen_version` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
