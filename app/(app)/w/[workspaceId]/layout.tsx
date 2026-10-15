"use client";

import type { ReactNode } from "react";
import { use } from "react";
import { CreateDialogProvider } from "@/components/create-dialog-provider";
import { GhostLogo } from "@/components/ghost-logo";
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
		<div
			role="status"
			className="grid min-h-[calc(100svh-3rem-var(--session-banner-height,0px))] place-content-center place-items-center gap-4 px-6 py-12 text-center text-muted-foreground"
		>
			<div aria-hidden className="motion-safe:animate-pulse">
				<GhostLogo className="size-8" />
			</div>
			<p className="text-sm">Switching workspace…</p>
		</div>
	);
}
