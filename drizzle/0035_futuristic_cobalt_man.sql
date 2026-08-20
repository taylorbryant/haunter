-- Better Auth 1.7 scopes account identity by (issuer, account_id). Haunter has
-- no social providers, so every existing account must be a credential row.
-- An unexpected provider intentionally produces NULL and aborts this migration
-- rather than guessing a trusted issuer.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TRIGGER IF EXISTS `oauth_client_unused_dynamic_limit`;--> statement-breakpoint
CREATE TABLE `__new_account` (
	`id` text PRIMARY KEY NOT NULL,
	`issuer` text NOT NULL,
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
INSERT INTO `__new_account` (
	`id`,
	`issuer`,
	`account_id`,
	`provider_id`,
	`user_id`,
	`access_token`,
	`refresh_token`,
	`id_token`,
	`access_token_expires_at`,
	`refresh_token_expires_at`,
	`scope`,
	`password`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	CASE WHEN `provider_id` = 'credential' THEN 'local:credential' ELSE NULL END,
	CASE WHEN `provider_id` = 'credential' THEN `user_id` ELSE `account_id` END,
	`provider_id`,
	`user_id`,
	`access_token`,
	`refresh_token`,
	`id_token`,
	`access_token_expires_at`,
	`refresh_token_expires_at`,
	`scope`,
	`password`,
	`created_at`,
	`updated_at`
FROM `account`;--> statement-breakpoint
DROP TABLE `account`;--> statement-breakpoint
ALTER TABLE `__new_account` RENAME TO `account`;--> statement-breakpoint
CREATE UNIQUE INDEX `account_issuer_accountId_uidx` ON `account` (`issuer`,`account_id`);--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint

-- 1.6 wrote all of these values, but its schema marked some columns nullable.
-- Preserve valid rows and turn any malformed nullable legacy access token into
-- an expired, unmatchable row instead of failing the structural migration.
CREATE TABLE `__new_oauth_refresh_token` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`client_id` text NOT NULL,
	`session_id` text,
	`user_id` text NOT NULL,
	`reference_id` text,
	`authorization_code_id` text,
	`resources` text,
	`requested_user_info_claims` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`revoked` integer,
	`rotated_at` integer,
	`rotation_replay_response` text,
	`rotation_replay_expires_at` integer,
	`auth_time` integer,
	`confirmation` text,
	`scopes` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_oauth_refresh_token` (
	`id`, `token`, `client_id`, `session_id`, `user_id`, `reference_id`,
	`expires_at`, `created_at`, `revoked`, `auth_time`, `scopes`
)
SELECT
	`id`, `token`, `client_id`, `session_id`, `user_id`, `reference_id`,
	COALESCE(`expires_at`, 0), COALESCE(`created_at`, 0), `revoked`, `auth_time`, `scopes`
FROM `oauth_refresh_token`;--> statement-breakpoint
DROP TABLE `oauth_refresh_token`;--> statement-breakpoint
ALTER TABLE `__new_oauth_refresh_token` RENAME TO `oauth_refresh_token`;--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_refresh_token_token_unique` ON `oauth_refresh_token` (`token`);--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_clientId_idx` ON `oauth_refresh_token` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_sessionId_idx` ON `oauth_refresh_token` (`session_id`);--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_userId_idx` ON `oauth_refresh_token` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauthRefreshToken_authorizationCodeId_idx` ON `oauth_refresh_token` (`authorization_code_id`);--> statement-breakpoint

CREATE TABLE `__new_oauth_access_token` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`client_id` text NOT NULL,
	`session_id` text,
	`user_id` text,
	`reference_id` text,
	`authorization_code_id` text,
	`resources` text,
	`requested_user_info_claims` text,
	`refresh_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`revoked` integer,
	`confirmation` text,
	`scopes` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`refresh_id`) REFERENCES `oauth_refresh_token`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_oauth_access_token` (
	`id`, `token`, `client_id`, `session_id`, `user_id`, `reference_id`,
	`refresh_id`, `expires_at`, `created_at`, `scopes`
)
SELECT
	`id`, COALESCE(`token`, 'invalidated:1.7:' || `id`), `client_id`,
	`session_id`, `user_id`, `reference_id`, `refresh_id`,
	COALESCE(`expires_at`, 0), COALESCE(`created_at`, 0), `scopes`
FROM `oauth_access_token`;--> statement-breakpoint
DROP TABLE `oauth_access_token`;--> statement-breakpoint
ALTER TABLE `__new_oauth_access_token` RENAME TO `oauth_access_token`;--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_access_token_token_unique` ON `oauth_access_token` (`token`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_clientId_idx` ON `oauth_access_token` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_sessionId_idx` ON `oauth_access_token` (`session_id`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_userId_idx` ON `oauth_access_token` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_authorizationCodeId_idx` ON `oauth_access_token` (`authorization_code_id`);--> statement-breakpoint
CREATE INDEX `oauthAccessToken_refreshId_idx` ON `oauth_access_token` (`refresh_id`);--> statement-breakpoint

CREATE TABLE `__new_oauth_consent` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text,
	`reference_id` text,
	`resources` text,
	`requested_user_info_claims` text,
	`scopes` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_oauth_consent` (
	`id`, `client_id`, `user_id`, `reference_id`, `scopes`, `created_at`, `updated_at`
)
SELECT
	`id`, `client_id`, `user_id`, `reference_id`, `scopes`,
	COALESCE(`created_at`, `updated_at`, CAST(strftime('%s', 'now') AS integer) * 1000),
	COALESCE(`updated_at`, `created_at`, CAST(strftime('%s', 'now') AS integer) * 1000)
FROM `oauth_consent`;--> statement-breakpoint
DROP TABLE `oauth_consent`;--> statement-breakpoint
ALTER TABLE `__new_oauth_consent` RENAME TO `oauth_consent`;--> statement-breakpoint
CREATE INDEX `oauthConsent_clientId_idx` ON `oauth_consent` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauthConsent_userId_idx` ON `oauth_consent` (`user_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint

ALTER TABLE `oauth_client` RENAME COLUMN `type` TO `application_type`;--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `client_discovery_id` text;--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `client_credentials_scopes` text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `backchannel_logout_uri` text;--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `backchannel_logout_session_required` integer;--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `jwks` text;--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `jwks_uri` text;--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `dpop_bound_access_tokens` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `oauth_client` DROP COLUMN `public`;--> statement-breakpoint

CREATE TABLE `oauth_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`name` text NOT NULL,
	`access_token_ttl` integer,
	`refresh_token_ttl` integer,
	`signing_algorithm` text,
	`signing_key_id` text,
	`allowed_scopes` text,
	`custom_claims` text,
	`dpop_bound_access_tokens_required` integer DEFAULT false,
	`disabled` integer DEFAULT false,
	`created_at` integer,
	`updated_at` integer,
	`policy_version` integer DEFAULT 1,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_resource_identifier_unique` ON `oauth_resource` (`identifier`);--> statement-breakpoint
CREATE TABLE `oauth_client_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`metadata` text,
	`created_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_id`) REFERENCES `oauth_resource`(`identifier`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauthClientResource_clientId_resourceId_uidx` ON `oauth_client_resource` (`client_id`,`resource_id`);--> statement-breakpoint
CREATE INDEX `oauthClientResource_clientId_idx` ON `oauth_client_resource` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauthClientResource_resourceId_idx` ON `oauth_client_resource` (`resource_id`);--> statement-breakpoint
CREATE TABLE `oauth_client_assertion` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint

ALTER TABLE `jwks` ADD `alg` text;--> statement-breakpoint
ALTER TABLE `jwks` ADD `crv` text;--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint

-- Restore the application-owned DCR quota trigger after the OAuth tables have
-- been rebuilt. Keep these ceilings aligned with the constants in
-- lib/oauth-dcr-request.ts.
CREATE TRIGGER `oauth_client_unused_dynamic_limit`
BEFORE INSERT ON `oauth_client`
WHEN
	(
		SELECT COUNT(*)
		FROM `oauth_client` AS `candidate`
		WHERE
			NOT EXISTS (
				SELECT 1 FROM `oauth_consent`
				WHERE `oauth_consent`.`client_id` = `candidate`.`client_id`
			)
			AND NOT EXISTS (
				SELECT 1 FROM `oauth_access_token`
				WHERE `oauth_access_token`.`client_id` = `candidate`.`client_id`
			)
			AND NOT EXISTS (
				SELECT 1 FROM `oauth_refresh_token`
				WHERE `oauth_refresh_token`.`client_id` = `candidate`.`client_id`
			)
			AND NOT EXISTS (
				SELECT 1 FROM `mcp_connection`
				WHERE
					`mcp_connection`.`client_id` = `candidate`.`client_id`
					AND `mcp_connection`.`status` = 'active'
			)
	) >= 1000
	OR
	(
		SELECT COUNT(*)
		FROM `oauth_client` AS `candidate`
		WHERE
			COALESCE(
				CASE
					WHEN
						json_valid(`candidate`.`metadata`) = 1
						AND json_type(`candidate`.`metadata`) = 'object'
					THEN json_extract(
						`candidate`.`metadata`,
						'$._haunter_dcr_allocation'
					)
					ELSE NULL
				END,
				'v1:unpartitioned'
			) = COALESCE(
				CASE
					WHEN
						json_valid(NEW.`metadata`) = 1
						AND json_type(NEW.`metadata`) = 'object'
					THEN json_extract(
						NEW.`metadata`,
						'$._haunter_dcr_allocation'
					)
					WHEN
						json_valid(NEW.`metadata`) = 1
						AND json_type(NEW.`metadata`) = 'text'
						AND json_valid(json_extract(NEW.`metadata`, '$')) = 1
						AND json_type(json_extract(NEW.`metadata`, '$')) = 'object'
					THEN json_extract(
						json_extract(NEW.`metadata`, '$'),
						'$._haunter_dcr_allocation'
					)
					ELSE NULL
				END,
				'v1:unpartitioned'
			)
			AND NOT EXISTS (
				SELECT 1 FROM `oauth_consent`
				WHERE `oauth_consent`.`client_id` = `candidate`.`client_id`
			)
			AND NOT EXISTS (
				SELECT 1 FROM `oauth_access_token`
				WHERE `oauth_access_token`.`client_id` = `candidate`.`client_id`
			)
			AND NOT EXISTS (
				SELECT 1 FROM `oauth_refresh_token`
				WHERE `oauth_refresh_token`.`client_id` = `candidate`.`client_id`
			)
			AND NOT EXISTS (
				SELECT 1 FROM `mcp_connection`
				WHERE
					`mcp_connection`.`client_id` = `candidate`.`client_id`
					AND `mcp_connection`.`status` = 'active'
			)
	) >= 50
BEGIN
	SELECT RAISE(ABORT, 'unused dynamic OAuth client quota exceeded');
END;
