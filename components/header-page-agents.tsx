"use client";

import { usePathname } from "next/navigation";
import { useCurrentUser } from "@/components/app-session-provider";
import { useProtectedRequestsEnabled } from "@/components/session-recovery-provider";
import { usePageAgents } from "@/features/agents/client/use-page-agents";
import { PageAgentPresence } from "@/features/agents/components/page-agent-presence";
import { useWorkspaceRouteSync } from "@/features/workspaces/client/use-workspace-route-sync";

export function HeaderPageAgents() {
	const pathname = usePathname();
	const user = useCurrentUser();
	const requestsEnabled = useProtectedRequestsEnabled();
	const workspaceId = pathname.match(/^\/w\/([^/]+)/)?.[1] ?? "";
	const pageId = pathname.match(/\/p\/([^/]+)/)?.[1] ?? "";
	const { synced } = useWorkspaceRouteSync(workspaceId || null);
	const agents = usePageAgents(user?.id ?? "", workspaceId, pageId);
	if (!user || !requestsEnabled || !synced || !pageId || !workspaceId)
		return null;
	return <PageAgentPresence key={`${workspaceId}:${pageId}`} agents={agents} />;
}
