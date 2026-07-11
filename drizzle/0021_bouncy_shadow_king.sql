CREATE TABLE `agent_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text,
	`capability` text NOT NULL,
	`status` text NOT NULL,
	`resource_type` text,
	`resource_id` text,
	`resource_label` text,
	`duration_ms` integer NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `agent_activity_user_created_idx` ON `agent_activity` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_activity_agent_created_idx` ON `agent_activity` (`agent_id`,`created_at`);