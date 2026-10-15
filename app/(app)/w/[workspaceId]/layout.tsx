"use client";

import type { ReactNode } from "react";
import { use } from "react";
import { CreateDialogProvider } from "@/components/create-dialog-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-error";
import { WorkspaceEventSubscriber } from "@/features/collab/client/workspace-events";
import { useWorkspaceRouteSync } from "@/features/workspaces/client/use-workspace-route-sync";

/**
 * Keep Better Auth's active organization in sync with the workspace in the
 * URL. The server resolves the request tenant from `activeOrganizationId`, so
 * children must not fetch until the active org matches the route — otherwise
 * they'd be scoped to the wrong (or no) workspace and denied.
 *
 * The route owns activation for both direct links and workspace switches.
 * Content stays gated until the refreshed session confirms the workspace.
 */
export default function WorkspaceLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ workspaceId: string }>;
}) {
	const { workspaceId } = use(params);
	const { synced, error, retry } = useWorkspaceRouteSync(workspaceId, {
		syncActive: true,
	});

	if (!synced && error)
		return (
			<div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8 md:py-10">
				<QueryError message={error} onRetry={retry} />
			</div>
		);
	if (!synced) return <WorkspaceSyncFallback />;

	return (
		<CreateDialogProvider workspaceId={workspaceId}>
			<WorkspaceEventSubscriber workspaceId={workspaceId} />
			{children}
		</CreateDialogProvider>
	);
}

function WorkspaceSyncFallback() {
	return (
		<div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8 md:py-10">
			<p role="status" className="mb-6 text-muted-foreground text-sm">
				Switching workspace…
			</p>
			<div className="mb-6 px-0 md:px-[54px]" aria-hidden>
				<Skeleton className="h-8 w-1/2 max-w-xs" />
			</div>
			<div className="flex flex-col gap-3 px-0 md:px-[54px]" aria-hidden>
				<Skeleton className="h-4 w-11/12" />
				<Skeleton className="h-4 w-4/5" />
				<Skeleton className="h-4 w-full" />
				<Skeleton className="mt-5 h-4 w-3/4" />
				<Skeleton className="h-4 w-2/5" />
			</div>
		</div>
	);
}
