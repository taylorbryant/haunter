import type { AgentCapabilityGrant } from "@/features/agents/ports";

export function grantWorkspaceScopeLabel(
	grant: AgentCapabilityGrant,
	workspaceNames: ReadonlyMap<string, string>,
): string | null {
	const workspaceConstraint = grant.constraints?.workspaceId;
	if (typeof workspaceConstraint === "string") {
		return workspaceNames.get(workspaceConstraint) ?? workspaceConstraint;
	}
	if (workspaceConstraint === undefined) return null;

	try {
		return JSON.stringify(workspaceConstraint);
	} catch {
		return "Restricted workspace scope";
	}
}
