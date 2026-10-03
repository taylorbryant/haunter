CREATE TABLE `embedded_editor_session` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`user_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`page_id` text NOT NULL,
	`challenge` text NOT NULL,
	`writable` integer NOT NULL,
	`credential_hash` text,
	`redeem_by` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `mcp_connection`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `embedded_editor_credential_idx` ON `embedded_editor_session` (`credential_hash`);--> statement-breakpoint
CREATE INDEX `embedded_editor_connection_idx` ON `embedded_editor_session` (`connection_id`);--> statement-breakpoint
CREATE INDEX `embedded_editor_expiry_idx` ON `embedded_editor_session` (`expires_at`);--> statement-breakpoint
ALTER TABLE `mcp_connection` ADD `embedded_editor_access` text DEFAULT 'view' NOT NULL;