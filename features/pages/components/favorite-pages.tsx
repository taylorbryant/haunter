"use client";

import { useQuery } from "@tanstack/react-query";
import { FileTextIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@/components/ui/sidebar";
import { getPageNavigationQueryOptions } from "@/features/pages/client/queries";
import { useWorkspaceRouteSync } from "@/features/workspaces/client/use-workspace-route-sync";

export function FavoritePages({ workspaceId }: { workspaceId: string }) {
	const pathname = usePathname();
	const { isMobile, setOpenMobile } = useSidebar();
	const { synced } = useWorkspaceRouteSync(workspaceId);
	const navigationQuery = useQuery({
		...getPageNavigationQueryOptions(workspaceId),
		enabled: synced,
	});
	const favorites = navigationQuery.data?.favorites ?? [];

	if (favorites.length === 0) return null;

	return (
		<SidebarGroup className="pb-0">
			<SidebarGroupLabel>Favorites</SidebarGroupLabel>
			<SidebarGroupContent>
				<SidebarMenu>
					{favorites.map((page) => (
						<SidebarMenuItem key={page.id}>
							<SidebarMenuButton
								render={
									<Link
										href={`/w/${workspaceId}/p/${page.id}`}
										onClick={() => {
											if (isMobile) setOpenMobile(false);
										}}
									/>
								}
								isActive={pathname === `/w/${workspaceId}/p/${page.id}`}
								title={page.title || "Untitled"}
							>
								{page.icon ? (
									<span aria-hidden>{page.icon}</span>
								) : (
									<FileTextIcon className="text-sidebar-foreground/60" />
								)}
								<span>{page.title || "Untitled"}</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
					))}
				</SidebarMenu>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}
