-- Better Auth 1.7.3+ identifies accounts by (provider_id, account_id) and
-- no longer writes issuer. Preserve legacy values for compatibility with
-- deployed readers, but allow new accounts to omit issuer.
-- Rebuild only account: Drizzle's generated Turso ALTER drops unrelated
-- indexes and attempts to drop the new index before it exists.
CREATE TABLE `__new_account` (
	`id` text PRIMARY KEY NOT NULL,
	`issuer` text,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Reject ambiguous provider keys before replacing the existing table.
CREATE UNIQUE INDEX `account_providerId_accountId_uidx` ON `__new_account` (`provider_id`,`account_id`);
--> statement-breakpoint
INSERT INTO `__new_account` (
	`id`, `issuer`, `account_id`, `provider_id`, `user_id`,
	`access_token`, `refresh_token`, `id_token`,
	`access_token_expires_at`, `refresh_token_expires_at`,
	`scope`, `password`, `created_at`, `updated_at`
)
SELECT
	`id`, `issuer`, `account_id`, `provider_id`, `user_id`,
	`access_token`, `refresh_token`, `id_token`,
	`access_token_expires_at`, `refresh_token_expires_at`,
	`scope`, `password`, `created_at`, `updated_at`
FROM `account`;
--> statement-breakpoint
DROP TABLE `account`;
--> statement-breakpoint
ALTER TABLE `__new_account` RENAME TO `account`;
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);
