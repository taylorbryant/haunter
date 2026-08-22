"use client";

import { useQuery } from "@tanstack/react-query";
import { FileTextIcon, ShapesIcon } from "lucide-react";
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
import { getCanvasNavigationQueryOptions } from "@/features/canvases/client/queries";
import { getPageNavigationQueryOptions } from "@/features/pages/client/queries";
import { useWorkspaceRouteSync } from "@/features/workspaces/client/use-workspace-route-sync";

export function FavoriteItems({ workspaceId }: { workspaceId: string }) {
	const pathname = usePathname();
	const { isMobile, setOpenMobile } = useSidebar();
	const { synced } = useWorkspaceRouteSync(workspaceId);
	const pageNavigationQuery = useQuery({
		...getPageNavigationQueryOptions(workspaceId),
		enabled: synced,
	});
	const canvasNavigationQuery = useQuery({
		...getCanvasNavigationQueryOptions(workspaceId),
		enabled: synced,
	});
	const favorites = [
		...(pageNavigationQuery.data?.favorites.map((page) => ({
			kind: "page" as const,
			id: page.id,
			title: page.title,
			icon: page.icon,
			favoritedAt: page.favoritedAt,
		})) ?? []),
		...(canvasNavigationQuery.data?.favorites.map((canvas) => ({
			kind: "canvas" as const,
			id: canvas.id,
			title: canvas.title,
			icon: null,
			favoritedAt: canvas.favoritedAt,
		})) ?? []),
	].sort((left, right) =>
		(right.favoritedAt ?? "").localeCompare(left.favoritedAt ?? ""),
	);

	if (favorites.length === 0) return null;

	return (
		<SidebarGroup className="pb-0">
			<SidebarGroupLabel>Favorites</SidebarGroupLabel>
			<SidebarGroupContent>
				<SidebarMenu>
					{favorites.map((item) => {
						const href =
							item.kind === "page"
								? `/w/${workspaceId}/p/${item.id}`
								: `/w/${workspaceId}/c/${item.id}`;
						return (
							<SidebarMenuItem key={`${item.kind}:${item.id}`}>
								<SidebarMenuButton
									render={
										<Link
											href={href}
											onClick={() => {
												if (isMobile) setOpenMobile(false);
											}}
										/>
									}
									isActive={pathname === href}
									title={item.title || "Untitled"}
								>
									{item.icon ? (
										<span aria-hidden>{item.icon}</span>
									) : item.kind === "canvas" ? (
										<ShapesIcon className="text-sidebar-foreground/60" />
									) : (
										<FileTextIcon className="text-sidebar-foreground/60" />
									)}
									<span>{item.title || "Untitled"}</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
						);
					})}
				</SidebarMenu>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}
