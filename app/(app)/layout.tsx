import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ActiveWorkspaceHintProvider } from "@/components/active-workspace-provider";
import { AppSidebar } from "@/components/app-sidebar";
import { HeaderBreadcrumbs } from "@/components/header-breadcrumbs";
import { HeaderPresence } from "@/components/header-presence";
import { HeaderSaveIndicator } from "@/components/header-save-indicator";
import { Separator } from "@/components/ui/separator";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@/components/ui/sidebar";
import { HeaderPageActions } from "@/components/header-page-actions";
import { hasAppAccessSession } from "@/lib/auth";
import { auth } from "@/lib/better-auth";
import { ADMIN_ROLE } from "@/ports/auth";

export default async function AppLayout({ children }: { children: ReactNode }) {
	const headerList = await headers();
	const session = await auth.api.getSession({ headers: headerList });

	if (!session) {
		// Reached with a stale session cookie (the proxy only checks presence).
		// x-requested-path is set by the proxy so the sign-in flow can return
		// the user to where they were headed.
		const requestedPath = headerList.get("x-requested-path");
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

	return (
		<ActiveWorkspaceHintProvider
			value={session.session.activeOrganizationId ?? null}
		>
			<SidebarProvider defaultOpen={defaultOpen}>
				<AppSidebar
					user={{
						name: session.user.name,
						email: session.user.email,
						image: session.user.image ?? null,
					}}
					isAdmin={session.user.role === ADMIN_ROLE}
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
		</ActiveWorkspaceHintProvider>
	);
}
