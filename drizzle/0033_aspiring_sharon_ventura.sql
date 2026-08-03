CREATE TABLE `collab_documents` (
	`document_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`last_state_vector` text,
	`seeded_at` text,
	`last_projected_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collab_documents_entity_idx` ON `collab_documents` (`kind`,`entity_id`);--> statement-breakpoint
CREATE INDEX `collab_documents_workspace_state_idx` ON `collab_documents` (`workspace_id`,`state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `outbox_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`payload_json` text NOT NULL,
	`trace_context_json` text,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`available_at` text NOT NULL,
	`claimed_at` text,
	`locked_until` text,
	`claim_token` text,
	`delivered_at` text,
	`last_error_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `outbox_messages_available_idx` ON `outbox_messages` (`status`,`available_at`);--> statement-breakpoint
CREATE INDEX `outbox_messages_locked_idx` ON `outbox_messages` (`status`,`locked_until`);