CREATE TABLE `collaboration_worker_lease` (
	`id` integer PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_page_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`icon` text,
	`content` text NOT NULL,
	`cause` text DEFAULT 'checkpoint' NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_page_versions`("id", "page_id", "workspace_id", "title", "icon", "content", "cause", "created_by", "created_at") SELECT "id", "page_id", "workspace_id", "title", "icon", "content", "cause", "created_by", "created_at" FROM `page_versions`;--> statement-breakpoint
DROP TABLE `page_versions`;--> statement-breakpoint
ALTER TABLE `__new_page_versions` RENAME TO `page_versions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `page_versions_page_created_idx` ON `page_versions` (`page_id`,`created_at`);