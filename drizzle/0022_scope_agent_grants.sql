-- Existing broad grants predate workspace-scoped capability approvals. Revoke
-- them so agents must request a new grant with a visible workspace constraint.
UPDATE `agent_capability_grant`
SET `status` = 'revoked'
WHERE `capability` <> 'list_workspaces'
	AND `constraints` IS NULL
	AND `status` IN ('active', 'pending');
