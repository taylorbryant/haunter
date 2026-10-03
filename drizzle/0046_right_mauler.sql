CREATE TABLE `__new_embedded_editor_session` (
 `id` text PRIMARY KEY NOT NULL,
 `connection_id` text NOT NULL REFERENCES `mcp_connection`(`id`) ON DELETE cascade,
 `user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE cascade,
 `workspace_id` text NOT NULL REFERENCES `organization`(`id`) ON DELETE cascade,
 `page_id` text,
 `canvas_id` text,
 `challenge` text NOT NULL,
 `writable` integer NOT NULL,
 `credential_hash` text,
 `redeem_by` integer NOT NULL,
 `expires_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_embedded_editor_session` (`id`, `connection_id`, `user_id`, `workspace_id`, `page_id`, `challenge`, `writable`, `credential_hash`, `redeem_by`, `expires_at`)
SELECT `id`, `connection_id`, `user_id`, `workspace_id`, `page_id`, `challenge`, `writable`, `credential_hash`, `redeem_by`, `expires_at` FROM `embedded_editor_session`;
--> statement-breakpoint
DROP TABLE `embedded_editor_session`;
--> statement-breakpoint
ALTER TABLE `__new_embedded_editor_session` RENAME TO `embedded_editor_session`;
--> statement-breakpoint
CREATE UNIQUE INDEX `embedded_editor_credential_idx` ON `embedded_editor_session` (`credential_hash`);
--> statement-breakpoint
CREATE INDEX `embedded_editor_connection_idx` ON `embedded_editor_session` (`connection_id`);
--> statement-breakpoint
CREATE INDEX `embedded_editor_expiry_idx` ON `embedded_editor_session` (`expires_at`);
