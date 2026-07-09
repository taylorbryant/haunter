import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { makeQueryClient } from "@/client";
import { ActiveWorkspaceHintProvider } from "@/components/active-workspace-provider";
import { AppSessionProvider } from "@/components/app-session-provider";
import { AppSidebar } from "@/components/app-sidebar";
import { AppCommands } from "@/components/command-palette/app-commands";
import { CommandRegistryProvider } from "@/components/command-palette/registry";
import { HeaderBreadcrumbs } from "@/components/header-breadcrumbs";
import { HeaderPresence } from "@/components/header-presence";
import { HeaderSaveIndicator } from "@/components/header-save-indicator";
import { HeaderPageActions } from "@/components/header-page-actions";
import { Separator } from "@/components/ui/separator";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@/components/ui/sidebar";
import { listPagesQueryOptions } from "@/features/pages/client/queries";
import { listPagesUseCase } from "@/features/pages/use-cases";
import { hasAppAccessSession } from "@/lib/auth";
import { auth } from "@/lib/better-auth";
import {
	getAppRequestContext,
	serverUseCaseQueryOptions,
} from "@/lib/server-react-query";
import { ADMIN_ROLE } from "@/ports/auth";

function routeIds(path: string | null) {
	const workspaceId = path?.match(/^\/w\/([^/?#]+)/)?.[1] ?? null;
	return { workspaceId };
}

export default async function AppLayout({ children }: { children: ReactNode }) {
	const [headerList, cookieStore, ctx] = await Promise.all([
		headers(),
		cookies(),
		getAppRequestContext(),
	]);
	const session = ctx.auth;
	const requestedPath = headerList.get("x-requested-path");

	if (!session) {
		// Reached with a stale session cookie (the proxy only checks presence).
		// x-requested-path is set by the proxy so the sign-in flow can return
		// the user to where they were headed.
		redirect(
			requestedPath
				? `/sign-in?next=${encodeURIComponent(requestedPath)}`
				: "/sign-in",
		);
	}
	if (!hasAppAccessSession(session)) {
		redirect("/waitlist");
	}

	const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

	const isAdmin = session.user.role === ADMIN_ROLE;
	const activeWorkspaceId = session.session?.activeOrganizationId ?? null;
	const queryClient = makeQueryClient();
	const { workspaceId } = routeIds(requestedPath);
	const workspaces = await auth.api.listOrganizations({ headers: headerList });

	if (workspaceId && activeWorkspaceId === workspaceId) {
		await Promise.allSettled([
			queryClient.prefetchQuery(
				serverUseCaseQueryOptions(
					listPagesQueryOptions(workspaceId),
					listPagesUseCase,
					ctx,
					{ workspaceId },
				),
			),
		]);
	}

	return (
		<HydrationBoundary state={dehydrate(queryClient)}>
			<AppSessionProvider
				value={{
					user: {
						id: session.user.id,
						name: session.user.name ?? "",
						email: session.user.email ?? "",
						image: session.user.image ?? null,
					},
					activeWorkspaceId,
					workspaceRole: ctx.membership?.role ?? null,
					workspaces: workspaces.map((workspace) => ({
						id: workspace.id,
						name: workspace.name,
						logo: workspace.logo ?? null,
					})),
					isAdmin,
				}}
			>
				<ActiveWorkspaceHintProvider value={activeWorkspaceId}>
					<CommandRegistryProvider>
						<SidebarProvider defaultOpen={defaultOpen}>
							<AppCommands isAdmin={isAdmin} />
							<AppSidebar
								user={{
									name: session.user.name ?? "",
									email: session.user.email ?? "",
									image: session.user.image ?? null,
								}}
								isAdmin={isAdmin}
							/>
							<SidebarInset>
								<header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 bg-background/90 px-3 backdrop-blur-sm">
									<SidebarTrigger />
									<Separator
										orientation="vertical"
										className="mr-2 data-vertical:h-4 data-vertical:self-auto"
									/>
									<HeaderBreadcrumbs />
									<HeaderSaveIndicator />
									<HeaderPresence />
									<HeaderPageActions />
								</header>
								<div className="min-w-0 flex-1">{children}</div>
							</SidebarInset>
						</SidebarProvider>
					</CommandRegistryProvider>
				</ActiveWorkspaceHintProvider>
			</AppSessionProvider>
		</HydrationBoundary>
	);
}
