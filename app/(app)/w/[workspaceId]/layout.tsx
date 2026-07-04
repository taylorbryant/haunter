"use client";

import { use, useEffect } from "react";
import type { ReactNode } from "react";
import { authClient } from "@/client/auth-client";

/**
 * Keep Better Auth's active organization in sync with the workspace in the
 * URL. The server resolves the request tenant from `activeOrganizationId`, so
 * children must not fetch until the active org matches the route — otherwise
 * they'd be scoped to the wrong (or no) workspace and denied.
 */
export default function WorkspaceLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ workspaceId: string }>;
}) {
	const { workspaceId } = use(params);
	const activeQuery = authClient.useActiveOrganization();
	const activeId = activeQuery.data?.id ?? null;
	const synced = activeId === workspaceId;

	useEffect(() => {
		if (!activeQuery.isPending && !synced) {
			authClient.organization.setActive({ organizationId: workspaceId });
		}
	}, [activeQuery.isPending, synced, workspaceId]);

	if (!synced) return null;

	return <>{children}</>;
}
