CREATE TABLE `collaborative_canvases` (
	`canvas_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`state` blob NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`canvas_id`) REFERENCES `canvases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
