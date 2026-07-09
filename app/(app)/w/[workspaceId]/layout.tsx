"use client";

import type { ReactNode } from "react";
import { use } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspaceRouteSync } from "@/features/workspaces/client/use-workspace-route-sync";

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
	const { synced } = useWorkspaceRouteSync(workspaceId, { syncActive: true });

	if (!synced) return <WorkspaceSyncFallback />;

	return <>{children}</>;
}

function WorkspaceSyncFallback() {
	return (
		<div
			className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8 md:py-10"
			aria-hidden
		>
			<div className="mb-6 px-0 md:px-[54px]">
				<Skeleton className="h-8 w-1/2 max-w-xs" />
			</div>
			<div className="flex flex-col gap-3 px-0 md:px-[54px]">
				<Skeleton className="h-4 w-11/12" />
				<Skeleton className="h-4 w-4/5" />
				<Skeleton className="h-4 w-full" />
				<Skeleton className="mt-5 h-4 w-3/4" />
				<Skeleton className="h-4 w-2/5" />
			</div>
		</div>
	);
}
