import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { makeQueryClient } from "@/client";
import { ActiveWorkspaceHintProvider } from "@/components/active-workspace-provider";
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
import { getPage, listPages } from "@/features/pages/contracts";
import { hasAppAccessSession } from "@/lib/auth";
import { auth } from "@/lib/better-auth";
import { createServerReactQuery } from "@/lib/server-react-query";
import { ADMIN_ROLE } from "@/ports/auth";

function routeIds(path: string | null) {
	const workspaceId = path?.match(/^\/w\/([^/?#]+)/)?.[1] ?? null;
	const pageId = path?.match(/\/p\/([^/?#]+)/)?.[1] ?? null;
	return { workspaceId, pageId };
}

export default async function AppLayout({ children }: { children: ReactNode }) {
	const headerList = await headers();
	const session = await auth.api.getSession({ headers: headerList });
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

	const cookieStore = await cookies();
	const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

	const isAdmin = session.user.role === ADMIN_ROLE;
	const queryClient = makeQueryClient();
	const { workspaceId, pageId } = routeIds(requestedPath);

	if (workspaceId && session.session.activeOrganizationId === workspaceId) {
		const serverRq = createServerReactQuery(headerList);
		const prefetches = [
			queryClient.prefetchQuery(
				serverRq(listPages).queryOptions({ path: { workspaceId } }),
			),
		];
		if (pageId) {
			prefetches.push(
				queryClient.prefetchQuery(
					serverRq(getPage).queryOptions({ path: { id: pageId } }),
				),
			);
		}
		await Promise.allSettled(prefetches);
	}

	return (
		<HydrationBoundary state={dehydrate(queryClient)}>
			<ActiveWorkspaceHintProvider
				value={session.session.activeOrganizationId ?? null}
			>
				<CommandRegistryProvider>
					<SidebarProvider defaultOpen={defaultOpen}>
						<AppCommands isAdmin={isAdmin} />
						<AppSidebar
							user={{
								name: session.user.name,
								email: session.user.email,
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
		</HydrationBoundary>
	);
}
