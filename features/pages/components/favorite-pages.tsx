"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileTextIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCurrentUser } from "@/components/app-session-provider";
import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@/components/ui/sidebar";
import {
	preloadPageCollaboration,
	preloadPageResources,
} from "@/features/pages/client/preload-page";
import {
	getPageNavigationQueryOptions,
	listPagesQueryOptions,
} from "@/features/pages/client/queries";
import { useWorkspaceRouteSync } from "@/features/workspaces/client/use-workspace-route-sync";

export function FavoritePages({ workspaceId }: { workspaceId: string }) {
	const pathname = usePathname();
	const queryClient = useQueryClient();
	const currentUser = useCurrentUser();
	const { isMobile, setOpenMobile } = useSidebar();
	const { synced } = useWorkspaceRouteSync(workspaceId);
	const navigationQuery = useQuery({
		...getPageNavigationQueryOptions(workspaceId),
		enabled: synced,
	});
	const favorites = navigationQuery.data?.favorites ?? [];
	const pagesQuery = useQuery({
		...listPagesQueryOptions(workspaceId),
		enabled: synced,
	});
	const cacheEpochByPageId = new Map(
		(pagesQuery.data?.items ?? []).map((page) => [
			page.id,
			page.documentCacheEpoch,
		]),
	);

	function preloadFavorite(pageId: string, includeRoom: boolean) {
		if (pathname === `/w/${workspaceId}/p/${pageId}`) return;
		preloadPageResources(queryClient, pageId);
		if (includeRoom && currentUser) {
			preloadPageCollaboration(
				pageId,
				currentUser.id,
				cacheEpochByPageId.get(pageId) ?? null,
			);
		}
	}

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
										onPointerEnter={() => preloadFavorite(page.id, false)}
										onFocus={() => preloadFavorite(page.id, true)}
										onPointerDown={() => preloadFavorite(page.id, true)}
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
