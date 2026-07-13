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
import { NotificationCenter } from "@/features/notifications/components/notification-center";
import { PageTree } from "@/features/pages/components/page-tree";
import { WorkspaceSwitcher } from "@/features/workspaces/components/workspace-switcher";

export function AppSidebar({
	user,
	isAdmin = false,
}: {
	user: { name: string; email: string; image: string | null };
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
				<WorkspaceSwitcher activeWorkspaceId={activeWorkspaceId} />
				<SidebarMenu>
					<SearchCommand />
					<NotificationCenter />
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
					<PageTree workspaceId={activeWorkspaceId} />
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
				<NavUser user={user} />
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
