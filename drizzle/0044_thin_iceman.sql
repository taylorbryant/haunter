CREATE TABLE `canvas_history` (
	`id` text PRIMARY KEY NOT NULL,
	`canvas_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`canvas_id`) REFERENCES `canvases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `canvas_history_canvas_revision_idx` ON `canvas_history` (`canvas_id`,`revision`);