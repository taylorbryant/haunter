import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ActiveWorkspaceHintProvider } from "@/components/active-workspace-provider";
import { AppSessionProvider } from "@/components/app-session-provider";
import { AppSidebar } from "@/components/app-sidebar";
import { AppCommands } from "@/components/command-palette/app-commands";
import { CommandRegistryProvider } from "@/components/command-palette/registry";
import { DeviceTimeProvider } from "@/components/device-time-provider";
import { HeaderBreadcrumbs } from "@/components/header-breadcrumbs";
import { HeaderPageActions } from "@/components/header-page-actions";
import { HeaderSaveIndicator } from "@/components/header-save-indicator";
import { Separator } from "@/components/ui/separator";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@/components/ui/sidebar";
import { WaitlistDialogProvider } from "@/features/admin/components/waitlist-dialog";
import { loadChangelogReleases } from "@/features/changelog/content";
import { NotificationTimezoneInitializer } from "@/features/notifications/components/notification-timezone-initializer";
import { hasAppAccessSession } from "@/lib/auth";
import {
	DEVICE_TIMEZONE_COOKIE_NAME,
	deviceTimeAt,
	pendingDeviceTime,
	readDeviceTimezoneCookie,
} from "@/lib/device-timezone";
import { getAppRequestContext } from "@/lib/server-react-query";
import { ADMIN_ROLE } from "@/ports/auth";

export default async function AppLayout({ children }: { children: ReactNode }) {
	const [headerList, cookieStore, ctx, changelogReleases] = await Promise.all([
		headers(),
		cookies(),
		getAppRequestContext(),
		loadChangelogReleases(),
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
	const now = new Date();
	const deviceTimezone = readDeviceTimezoneCookie(
		cookieStore.get(DEVICE_TIMEZONE_COOKIE_NAME)?.value,
	);
	const initialDeviceTime = deviceTimezone
		? deviceTimeAt(now, deviceTimezone)
		: pendingDeviceTime(now.getTime());

	return (
		<DeviceTimeProvider initialValue={initialDeviceTime}>
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
					isAdmin,
				}}
			>
				<ActiveWorkspaceHintProvider value={activeWorkspaceId}>
					<NotificationTimezoneInitializer />
					<CommandRegistryProvider>
						<SidebarProvider defaultOpen={defaultOpen}>
							<WaitlistDialogProvider enabled={isAdmin}>
								<AppCommands />
								<AppSidebar
									user={{
										name: session.user.name ?? "",
										email: session.user.email ?? "",
										image: session.user.image ?? null,
									}}
									changelogReleases={changelogReleases}
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
										<HeaderPageActions />
									</header>
									<div className="min-w-0 flex-1">{children}</div>
								</SidebarInset>
							</WaitlistDialogProvider>
						</SidebarProvider>
					</CommandRegistryProvider>
				</ActiveWorkspaceHintProvider>
			</AppSessionProvider>
		</DeviceTimeProvider>
	);
}
