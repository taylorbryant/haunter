"use client";

import { ListTodoIcon, Trash2Icon } from "lucide-react";
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
import { PageTree } from "@/features/pages/components/page-tree";
import { WorkspaceSwitcher } from "@/features/workspaces/components/workspace-switcher";

export function AppSidebar({
	user,
}: {
	user: { name: string; email: string };
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
					<SidebarMenuItem>
						<SidebarMenuButton
							asChild
							isActive={
								activeWorkspaceId !== null &&
								pathname === `/w/${activeWorkspaceId}/tasks`
							}
							tooltip="Tasks"
						>
							<Link
								href={activeWorkspaceId ? `/w/${activeWorkspaceId}/tasks` : "/"}
								onClick={closeSheetOnMobile}
							>
								<ListTodoIcon />
								<span>Tasks</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>
			<SidebarContent>
				{activeWorkspaceId ? (
					<PageTree workspaceId={activeWorkspaceId} />
				) : null}
				{activeWorkspaceId ? (
					<SidebarGroup className="mt-auto">
						<SidebarGroupContent>
							<SidebarMenu>
								<SidebarMenuItem>
									<SidebarMenuButton
										asChild
										isActive={pathname === `/w/${activeWorkspaceId}/trash`}
										tooltip="Trash"
									>
										<Link
											href={`/w/${activeWorkspaceId}/trash`}
											onClick={closeSheetOnMobile}
										>
											<Trash2Icon />
											<span>Trash</span>
										</Link>
									</SidebarMenuButton>
								</SidebarMenuItem>
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
