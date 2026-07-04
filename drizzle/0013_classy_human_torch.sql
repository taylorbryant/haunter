CREATE TABLE `agent` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`user_id` text,
	`host_id` text NOT NULL,
	`status` text NOT NULL,
	`mode` text NOT NULL,
	`public_key` text NOT NULL,
	`kid` text,
	`jwks_url` text,
	`last_used_at` integer,
	`activated_at` integer,
	`expires_at` integer,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `agent_host`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_capability_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`capability` text NOT NULL,
	`denied_by` text,
	`granted_by` text,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`constraints` text,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`denied_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`granted_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_host` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`user_id` text,
	`default_capabilities` text,
	`public_key` text,
	`kid` text,
	`jwks_url` text,
	`enrollment_token_hash` text,
	`enrollment_token_expires_at` integer,
	`status` text NOT NULL,
	`activated_at` integer,
	`expires_at` integer,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `approval_request` (
	`id` text PRIMARY KEY NOT NULL,
	`method` text NOT NULL,
	`agent_id` text,
	`host_id` text,
	`user_id` text,
	`capabilities` text,
	`status` text NOT NULL,
	`user_code_hash` text,
	`login_hint` text,
	`binding_message` text,
	`client_notification_token` text,
	`client_notification_endpoint` text,
	`delivery_mode` text,
	`interval` integer NOT NULL,
	`last_polled_at` integer,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `agent_host`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
