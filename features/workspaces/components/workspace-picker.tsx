"use client";

import { CheckIcon, ChevronDownIcon, type LucideIcon } from "lucide-react";
import { Fragment } from "react";
import { GhostLogo } from "@/components/ghost-logo";
import { Button } from "@/components/ui/button";
import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "@/components/ui/drawer";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSkeleton,
	useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export type WorkspacePickerAction = {
	label: string;
	icon: LucideIcon;
	onSelect(): void;
	destructive?: boolean;
	muted?: boolean;
	separatorBefore?: boolean;
};

type WorkspaceOption = { id: string; name: string; logo?: string | null };
const workspaceLabel = (workspace: WorkspaceOption) =>
	`${workspace.logo ? `${workspace.logo} ` : ""}${workspace.name}`;

/** Presentation only: the host owns fetching, switching and management actions. */
export function WorkspacePicker({
	workspaces,
	activeWorkspaceId,
	onSelect,
	initialLoading = false,
	unavailable = false,
	onRetry,
	actions = [],
	className,
}: {
	workspaces: readonly WorkspaceOption[];
	activeWorkspaceId: string | null;
	onSelect(id: string): void | Promise<void>;
	initialLoading?: boolean;
	unavailable?: boolean;
	onRetry?(): void;
	actions?: readonly WorkspacePickerAction[];
	className?: string;
}) {
	const { isMobile } = useSidebar();
	const active = workspaces.find(
		(workspace) => workspace.id === activeWorkspaceId,
	);
	function selectWorkspace(id: string) {
		if (id !== activeWorkspaceId) void onSelect(id);
	}
	const trigger = (
		<SidebarMenuButton
			className="w-fit px-1.5 font-medium"
			aria-label={`Workspace: ${active ? workspaceLabel(active) : "Haunter"}`}
		>
			<GhostLogo className="size-4 shrink-0" />
			<span className="truncate">
				{active ? workspaceLabel(active) : "Haunter"}
			</span>
			<ChevronDownIcon className="opacity-50" />
		</SidebarMenuButton>
	);
	return (
		<SidebarMenu className={className}>
			<SidebarMenuItem>
				{initialLoading ? (
					<SidebarMenuSkeleton showIcon className="opacity-70" />
				) : unavailable ? (
					<SidebarMenuButton onClick={onRetry}>
						<span className="text-destructive">Workspaces unavailable</span>
					</SidebarMenuButton>
				) : isMobile ? (
					<Drawer showSwipeHandle>
						<DrawerTrigger render={trigger} />
						<DrawerContent>
							<DrawerHeader>
								<DrawerTitle>Workspaces</DrawerTitle>
								<DrawerDescription className="sr-only">
									{actions.length
										? "Switch or manage workspaces"
										: "Switch workspace"}
								</DrawerDescription>
							</DrawerHeader>
							<div className="flex flex-col gap-1 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
								{workspaces.map((workspace) => (
									<DrawerClose
										key={workspace.id}
										render={
											<Button
												variant="ghost"
												className="h-11 justify-start"
												onClick={() => selectWorkspace(workspace.id)}
											/>
										}
									>
										<span className="flex-1 truncate text-left">
											{workspaceLabel(workspace)}
										</span>
										{workspace.id === activeWorkspaceId ? <CheckIcon /> : null}
									</DrawerClose>
								))}
								{actions.map((action, index) => (
									<Fragment key={action.label}>
										{index === 0 || action.separatorBefore ? (
											<div className="my-1 h-px bg-border" />
										) : null}
										<DrawerClose
											render={
												<Button
													variant="ghost"
													className={cn(
														"h-11 justify-start",
														action.muted && "text-muted-foreground",
														action.destructive &&
															"text-destructive hover:text-destructive",
													)}
													onClick={action.onSelect}
												/>
											}
										>
											<action.icon />
											{action.label}
										</DrawerClose>
									</Fragment>
								))}
							</div>
						</DrawerContent>
					</Drawer>
				) : (
					<DropdownMenu>
						<DropdownMenuTrigger render={trigger} />
						<DropdownMenuContent
							className="w-56 rounded-lg"
							align="start"
							side="bottom"
							sideOffset={4}
							// Returning focus would steal it from dialogs opened by actions.
							finalFocus={() => false}
						>
							<DropdownMenuGroup>
								<DropdownMenuLabel className="text-muted-foreground text-xs">
									Workspaces
								</DropdownMenuLabel>
								{workspaces.map((workspace) => (
									<DropdownMenuItem
										key={workspace.id}
										onClick={() => selectWorkspace(workspace.id)}
									>
										<span className="truncate">
											{workspaceLabel(workspace)}
										</span>
										{workspace.id === activeWorkspaceId ? (
											<CheckIcon className="ml-auto" />
										) : null}
									</DropdownMenuItem>
								))}
							</DropdownMenuGroup>
							{actions.map((action, index) => (
								<Fragment key={action.label}>
									{index === 0 || action.separatorBefore ? (
										<DropdownMenuSeparator />
									) : null}
									<DropdownMenuItem
										className={cn(
											action.destructive &&
												"text-destructive focus:text-destructive",
										)}
										onClick={action.onSelect}
									>
										<action.icon
											className={cn(action.destructive && "text-destructive")}
										/>
										<span
											className={cn(
												action.muted && "font-medium text-muted-foreground",
											)}
										>
											{action.label}
										</span>
									</DropdownMenuItem>
								</Fragment>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				)}
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
