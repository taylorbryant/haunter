CREATE TABLE `collab_task_attributions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`block_id` text NOT NULL,
	`assignee` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `collab_documents`(`document_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collab_task_attributions_document_idx` ON `collab_task_attributions` (`document_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `collab_task_attributions_operation_idx` ON `collab_task_attributions` (`document_id`,`block_id`,`assignee`,`actor_user_id`);