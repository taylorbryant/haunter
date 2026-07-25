-- Anonymous RFC 7591 registration is intentionally public for MCP clients.
-- Bound only registrations that have never reached a user grant; consented,
-- token-bearing, and app-connected clients are outside this allocation pool.
-- Keep the ceiling aligned with OAUTH_DCR_MAX_UNUSED_CLIENTS.
CREATE TRIGGER `oauth_client_unused_anonymous_limit`
BEFORE INSERT ON `oauth_client`
WHEN
	NEW.`user_id` IS NULL
	AND NEW.`reference_id` IS NULL
	AND NEW.`public` = 1
	AND NEW.`token_endpoint_auth_method` = 'none'
	AND (
		SELECT COUNT(*)
		FROM `oauth_client` AS `candidate`
		WHERE
			`candidate`.`user_id` IS NULL
			AND `candidate`.`reference_id` IS NULL
			AND `candidate`.`public` = 1
			AND `candidate`.`token_endpoint_auth_method` = 'none'
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
				WHERE `mcp_connection`.`client_id` = `candidate`.`client_id`
			)
	) >= 1000
BEGIN
	SELECT RAISE(ABORT, 'unused anonymous OAuth client quota exceeded');
END;
