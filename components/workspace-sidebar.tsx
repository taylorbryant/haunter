"use client";

import { HouseIcon, ListTodoIcon, ShapesIcon, Trash2Icon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import {
	WorkspaceLink,
	useWorkspacePathname,
} from "@/client/workspace-navigation";
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
import { FavoriteItems } from "@/features/pages/components/favorite-pages";
import { PageTree } from "@/features/pages/components/page-tree";

const destinations = {
	home: { label: "Home", Icon: HouseIcon },
	tasks: { label: "Tasks", Icon: ListTodoIcon },
	canvases: { label: "Canvases", Icon: ShapesIcon },
	trash: { label: "Trash", Icon: Trash2Icon },
};

/** Shared workspace chrome. Each host supplies its available account controls. */
export function WorkspaceSidebar({
	workspaceId,
	workspaceSwitcher,
	headerActions,
	utilityActions,
	footer,
	showTasks = true,
	preferShiftShortcut = false,
	pageTreeProps,
	className,
}: {
	workspaceId: string | null;
	workspaceSwitcher: ReactNode;
	headerActions?: ReactNode;
	utilityActions?: ReactNode;
	footer: ReactNode;
	showTasks?: boolean;
	preferShiftShortcut?: boolean;
	pageTreeProps?: Omit<ComponentProps<typeof PageTree>, "workspaceId">;
	className?: string;
}) {
	return (
		<Sidebar className={className}>
			<SidebarHeader>
				<div className="flex items-center justify-between gap-2 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:items-start">
					<div className="min-w-0 flex-1 group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:flex-none">
						{workspaceSwitcher}
					</div>
					{headerActions ? (
						<SidebarMenu className="w-fit shrink-0 group-data-[collapsible=icon]:w-full">
							{headerActions}
						</SidebarMenu>
					) : null}
				</div>
				<SidebarMenu className="gap-0.5">
					<SearchCommand preferShiftShortcut={preferShiftShortcut} />
					<WorkspaceNavItem workspaceId={workspaceId} section="home" />
					{showTasks ? (
						<WorkspaceNavItem workspaceId={workspaceId} section="tasks" />
					) : null}
					<WorkspaceNavItem workspaceId={workspaceId} section="canvases" />
				</SidebarMenu>
			</SidebarHeader>
			<SidebarContent>
				{workspaceId ? (
					<>
						<FavoriteItems workspaceId={workspaceId} />
						<PageTree {...pageTreeProps} workspaceId={workspaceId} />
					</>
				) : null}
				{workspaceId || utilityActions ? (
					<SidebarGroup className="mt-auto">
						<SidebarGroupContent>
							<SidebarMenu>
								{utilityActions}
								{workspaceId ? (
									<WorkspaceNavItem workspaceId={workspaceId} section="trash" />
								) : null}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				) : null}
			</SidebarContent>
			<SidebarFooter>{footer}</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}

function WorkspaceNavItem({
	workspaceId,
	section,
	className,
}: {
	workspaceId: string | null;
	section: keyof typeof destinations;
	className?: string;
}) {
	const pathname = useWorkspacePathname();
	const { isMobile, setOpenMobile } = useSidebar();
	const { label, Icon } = destinations[section];
	const root = workspaceId ? `/w/${encodeURIComponent(workspaceId)}` : null;
	return (
		<SidebarMenuItem className={className}>
			<SidebarMenuButton
				render={
					<WorkspaceLink
						href={root ? `${root}/${section}` : "/"}
						onClick={() => {
							if (isMobile) setOpenMobile(false);
						}}
					/>
				}
				isActive={
					root !== null &&
					(pathname === `${root}/${section}` ||
						(section === "canvases" && pathname.startsWith(`${root}/c/`)))
				}
				tooltip={label}
			>
				<Icon />
				<span>{label}</span>
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}
