"use client";

import {
	ListTodoIcon,
	ShieldCheckIcon,
	SunIcon,
	Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavUser } from "@/components/nav-user";
import { SearchCommand } from "@/components/search-command";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	useSidebar,
} from "@/components/ui/sidebar";
import type { ChangelogRelease } from "@/features/changelog/releases";
import { NotificationCenter } from "@/features/notifications/components/notification-center";
import { FavoritePages } from "@/features/pages/components/favorite-pages";
import { PageTree } from "@/features/pages/components/page-tree";
import { WorkspaceSwitcher } from "@/features/workspaces/components/workspace-switcher";

export function AppSidebar({
	user,
	changelogReleases,
	isAdmin = false,
}: {
	user: { name: string; email: string; image: string | null };
	changelogReleases: readonly ChangelogRelease[];
	isAdmin?: boolean;
}) {
	const pathname = usePathname();
	const activeWorkspaceId = pathname.match(/^\/w\/([^/]+)/)?.[1] ?? null;
	const { isMobile, setOpenMobile } = useSidebar();

	// On mobile, navigating from the sidebar closes the overlay sheet.
	function closeSheetOnMobile() {
		if (isMobile) setOpenMobile(false);
	}

	return (
		<Sidebar>
			<SidebarHeader>
				<div className="flex items-center justify-between gap-2 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:items-start">
					<div className="min-w-0 flex-1 group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:flex-none">
						<WorkspaceSwitcher activeWorkspaceId={activeWorkspaceId} />
					</div>
					<SidebarMenu className="w-fit shrink-0 group-data-[collapsible=icon]:w-full">
						<NotificationCenter />
					</SidebarMenu>
				</div>
				<SidebarMenu className="gap-0.5">
					<SearchCommand />
					<SidebarMenuItem>
						<SidebarMenuButton
							render={
								<Link
									href={
										activeWorkspaceId ? `/w/${activeWorkspaceId}/today` : "/"
									}
									onClick={closeSheetOnMobile}
								/>
							}
							isActive={
								activeWorkspaceId !== null &&
								pathname === `/w/${activeWorkspaceId}/today`
							}
							tooltip="Today"
						>
							<SunIcon />
							<span>Today</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton
							render={
								<Link
									href={
										activeWorkspaceId ? `/w/${activeWorkspaceId}/tasks` : "/"
									}
									onClick={closeSheetOnMobile}
								/>
							}
							isActive={
								activeWorkspaceId !== null &&
								pathname === `/w/${activeWorkspaceId}/tasks`
							}
							tooltip="Tasks"
						>
							<ListTodoIcon />
							<span>Tasks</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>
			<SidebarContent>
				{activeWorkspaceId ? (
					<>
						<FavoritePages workspaceId={activeWorkspaceId} />
						<PageTree workspaceId={activeWorkspaceId} />
					</>
				) : null}
				{activeWorkspaceId || isAdmin ? (
					<SidebarGroup className="mt-auto">
						<SidebarGroupContent>
							<SidebarMenu>
								{isAdmin ? (
									<SidebarMenuItem>
										<SidebarMenuButton
											render={
												<Link href="/admin" onClick={closeSheetOnMobile} />
											}
											isActive={pathname === "/admin"}
											tooltip="Waitlist"
										>
											<ShieldCheckIcon />
											<span>Waitlist</span>
										</SidebarMenuButton>
									</SidebarMenuItem>
								) : null}
								{activeWorkspaceId ? (
									<SidebarMenuItem>
										<SidebarMenuButton
											render={
												<Link
													href={`/w/${activeWorkspaceId}/trash`}
													onClick={closeSheetOnMobile}
												/>
											}
											isActive={pathname === `/w/${activeWorkspaceId}/trash`}
											tooltip="Trash"
										>
											<Trash2Icon />
											<span>Trash</span>
										</SidebarMenuButton>
									</SidebarMenuItem>
								) : null}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				) : null}
			</SidebarContent>
			<SidebarFooter>
				<NavUser user={user} changelogReleases={changelogReleases} />
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
