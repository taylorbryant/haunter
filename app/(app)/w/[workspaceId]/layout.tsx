"use client";

import type { ReactNode } from "react";
import { use, useEffect } from "react";
import { authClient } from "@/client/auth-client";
import { useActiveWorkspaceHint } from "@/components/active-workspace-provider";

/**
 * Keep Better Auth's active organization in sync with the workspace in the
 * URL. The server resolves the request tenant from `activeOrganizationId`, so
 * children must not fetch until the active org matches the route — otherwise
 * they'd be scoped to the wrong (or no) workspace and denied.
 *
 * Cold-load fast path: while the client org store is still loading, trust the
 * server-rendered hint. It came from the same session the server used to
 * render this document, so if it matches the URL the tenant is already right
 * and children can fetch immediately — this removes a blank-screen round trip
 * from every hard load. Once the store resolves it takes over as the source
 * of truth (the hint goes stale across soft navigations).
 */
export default function WorkspaceLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ workspaceId: string }>;
}) {
	const { workspaceId } = use(params);
	const serverHint = useActiveWorkspaceHint();
	const activeQuery = authClient.useActiveOrganization();
	const activeId = activeQuery.data?.id ?? null;
	const synced = activeQuery.isPending
		? serverHint === workspaceId
		: activeId === workspaceId;

	useEffect(() => {
		if (!activeQuery.isPending && activeId !== workspaceId) {
			authClient.organization.setActive({ organizationId: workspaceId });
		}
	}, [activeQuery.isPending, activeId, workspaceId]);

	if (!synced) return null;

	return <>{children}</>;
}
