-- Replace the anonymous-only ceiling with one lifecycle for every OAuth
-- client created by Haunter's hosted MCP provider. Existing rows all belong
-- to this provider (the table was introduced with hosted MCP in 0027), so
-- backfill them into a legacy allocation partition.
DROP TRIGGER IF EXISTS `oauth_client_unused_anonymous_limit`;
--> statement-breakpoint

-- Better Auth's adapter serializes array-valued OAuth fields before passing
-- them to Drizzle. The original JSON-mode columns encoded those strings a
-- second time. Normalize existing rows to the single serialized form expected
-- by Better Auth and the corrected plain-text Drizzle mappings.
UPDATE `oauth_client`
SET
	`scopes` = CASE
		WHEN json_valid(`scopes`) = 1 AND json_type(`scopes`) = 'text'
		THEN json_extract(`scopes`, '$')
		ELSE `scopes`
	END,
	`contacts` = CASE
		WHEN json_valid(`contacts`) = 1 AND json_type(`contacts`) = 'text'
		THEN json_extract(`contacts`, '$')
		ELSE `contacts`
	END,
	`redirect_uris` = CASE
		WHEN json_valid(`redirect_uris`) = 1 AND json_type(`redirect_uris`) = 'text'
		THEN json_extract(`redirect_uris`, '$')
		ELSE `redirect_uris`
	END,
	`post_logout_redirect_uris` = CASE
		WHEN
			json_valid(`post_logout_redirect_uris`) = 1
			AND json_type(`post_logout_redirect_uris`) = 'text'
		THEN json_extract(`post_logout_redirect_uris`, '$')
		ELSE `post_logout_redirect_uris`
	END,
	`grant_types` = CASE
		WHEN json_valid(`grant_types`) = 1 AND json_type(`grant_types`) = 'text'
		THEN json_extract(`grant_types`, '$')
		ELSE `grant_types`
	END,
	`response_types` = CASE
		WHEN
			json_valid(`response_types`) = 1
			AND json_type(`response_types`) = 'text'
		THEN json_extract(`response_types`, '$')
		ELSE `response_types`
	END;
--> statement-breakpoint

UPDATE `oauth_refresh_token`
SET `scopes` = json_extract(`scopes`, '$')
WHERE json_valid(`scopes`) = 1 AND json_type(`scopes`) = 'text';
--> statement-breakpoint

UPDATE `oauth_access_token`
SET `scopes` = json_extract(`scopes`, '$')
WHERE json_valid(`scopes`) = 1 AND json_type(`scopes`) = 'text';
--> statement-breakpoint

UPDATE `oauth_consent`
SET `scopes` = json_extract(`scopes`, '$')
WHERE json_valid(`scopes`) = 1 AND json_type(`scopes`) = 'text';
--> statement-breakpoint

UPDATE `oauth_client`
SET `metadata` = CASE
	WHEN
		json_valid(`metadata`) = 1
		AND json_type(`metadata`) = 'object'
	THEN json_set(
		`metadata`,
		'$._haunter_dcr_allocation',
		'v1:legacy'
	)
	WHEN
		json_valid(`metadata`) = 1
		AND json_type(`metadata`) = 'text'
		AND json_valid(json_extract(`metadata`, '$')) = 1
		AND json_type(json_extract(`metadata`, '$')) = 'object'
	THEN json_set(
		json_extract(`metadata`, '$'),
		'$._haunter_dcr_allocation',
		'v1:legacy'
	)
	ELSE json_object('_haunter_dcr_allocation', 'v1:legacy')
END;
--> statement-breakpoint

-- The global ceiling is the emergency brake. The per-source partition keeps
-- one caller from consuming the entire shared pool. New DCR requests carry a
-- server-generated HMAC allocation marker; unmarked writes share a small
-- fallback partition so older app instances cannot bypass the bound.
-- Keep these ceilings aligned with OAUTH_DCR_MAX_UNUSED_CLIENTS and
-- OAUTH_DCR_MAX_UNUSED_CLIENTS_PER_SOURCE.
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
