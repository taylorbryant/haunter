CREATE TABLE `recovery_parts` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`upload_id` text NOT NULL,
	`part` integer NOT NULL,
	`data` blob NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`, `upload_id`, `part`),
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recovery_parts_expiry_idx` ON `recovery_parts` (`expires_at`);