"use client";

import { useRef, type DragEvent } from "react";
import {
	ChevronRightIcon,
	FileTextIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PlusIcon,
	SmilePlusIcon,
	StarIcon,
	Trash2Icon,
} from "lucide-react";
import { WorkspaceLink as Link } from "@/client/workspace-navigation";
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
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	SidebarInput,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@/components/ui/sidebar";
import {
	getPageDropZone,
	type PageDropZone,
} from "../client/page-tree-controller";
import { PAGE_TITLE_MAX_LENGTH, type PageMeta } from "../schemas";
import { useInlineEditFocus } from "@/hooks/use-inline-edit-focus";
import { cn } from "@/lib/utils";

type PageTreeRowProps = {
	page: Pick<PageMeta, "id" | "title" | "icon">;
	workspaceId: string;
	active: boolean;
	expanded: boolean;
	hasChildren: boolean;
	canEdit: boolean;
	isCreatingPage: boolean;
	dialogOpen: boolean;
	favorite: {
		selected: boolean;
		disabled: boolean;
		onToggle: () => void;
	};
	rename: {
		active: boolean;
		value: string;
		invalid: boolean;
		onStart: () => void;
		onChange: (value: string) => void;
		onCommit: () => void;
		onCancel: () => void;
	};
	drag: {
		active: boolean;
		targetZone: PageDropZone | null;
		canDrop: boolean;
		draggedId: string | null;
		onStart: () => void;
		onEnd: () => void;
		onHover: (zone: PageDropZone) => void;
		onLeave: () => void;
		onDrop: (draggedId: string, zone: PageDropZone) => void;
	};
	onExpand: () => void;
	onCreate: () => void;
	onIcon: () => void;
	onTrash: () => void;
	onPrefetch: () => void;
	className?: string;
};

function zoneFromPointer(event: DragEvent<HTMLLIElement>): PageDropZone {
	const rect = event.currentTarget.getBoundingClientRect();
	return getPageDropZone(event.clientY, rect.top, rect.height);
}

export function PageTreeRow({
	page,
	workspaceId,
	active,
	expanded,
	hasChildren,
	canEdit,
	isCreatingPage,
	dialogOpen,
	favorite,
	rename,
	drag,
	onExpand,
	onCreate,
	onIcon,
	onTrash,
	onPrefetch,
	className,
}: PageTreeRowProps) {
	const { isMobile, setOpenMobile } = useSidebar();
	const renameFocus = useInlineEditFocus();
	const transferringRenameFocus = useRef(false);
	// Mobile renames use the shared dialog, while desktop renames stay in this row.
	const isRenaming = rename.active && !isMobile;

	function startDesktopRename() {
		// Closing the menu must not steal focus from the input replacing this row.
		transferringRenameFocus.current = true;
		rename.onStart();
	}

	return (
		<SidebarMenuItem
			draggable={canEdit && !isRenaming}
			className={cn(
				drag.active && "opacity-50",
				drag.targetZone === "inside" && "rounded-md ring-2 ring-primary/60",
				drag.targetZone === "before" && "shadow-[0_-2px_0_0_var(--primary)]",
				drag.targetZone === "after" && "shadow-[0_2px_0_0_var(--primary)]",
				className,
			)}
			onDragStart={(event) => {
				event.stopPropagation();
				event.dataTransfer.setData("text/plain", page.id);
				event.dataTransfer.effectAllowed = "move";
				drag.onStart();
			}}
			onDragEnd={() => {
				drag.onEnd();
			}}
			onDragOver={(event) => {
				if (!drag.canDrop) return;
				event.preventDefault();
				event.stopPropagation();
				event.dataTransfer.dropEffect = "move";
				const zone = zoneFromPointer(event);
				drag.onHover(zone);
			}}
			onDragLeave={() => {
				drag.onLeave();
			}}
			onDrop={(event) => {
				event.preventDefault();
				event.stopPropagation();
				const draggedId =
					event.dataTransfer.getData("text/plain") || drag.draggedId;
				if (draggedId) {
					drag.onDrop(draggedId, zoneFromPointer(event));
				}
				drag.onEnd();
			}}
		>
			{isRenaming ? (
				<SidebarInput
					aria-label="Page name"
					autoFocus
					className="h-8"
					value={rename.value}
					maxLength={PAGE_TITLE_MAX_LENGTH}
					aria-invalid={rename.invalid || undefined}
					onChange={(event) => {
						rename.onChange(event.target.value);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter" || event.key === "Escape") {
							event.preventDefault();
							renameFocus.requestReturn(event.currentTarget);
						}
						if (event.key === "Enter") rename.onCommit();
						if (event.key === "Escape") rename.onCancel();
					}}
					onBlur={() => rename.onCommit()}
				/>
			) : (
				<SidebarMenuButton
					render={
						<Link
							ref={renameFocus.returnTargetRef}
							href={`/w/${workspaceId}/p/${page.id}`}
							onFocus={() => onPrefetch()}
							onPointerDown={() => onPrefetch()}
							onPointerEnter={() => onPrefetch()}
							// On mobile, tapping a page navigates and closes the
							// sidebar sheet so the page is visible immediately.
							onClick={() => {
								if (isMobile) setOpenMobile(false);
							}}
						/>
					}
					isActive={active}
					title={page.title}
					// Two hover actions sit on the right (••• at right-6, + at
					// right-1); the default pr-8 clearance lets text run under
					// them, so widen it.
					className="group-has-data-[sidebar=menu-action]/menu-item:pr-13"
				>
					{/* On mobile the expand chevron is always shown (no hover)
					    and sits over this icon slot; keep the slot but hide the
					    glyph so the chevron doesn't overlap the emoji. */}
					{page.icon ? (
						<span className={cn(isMobile && hasChildren && "invisible")}>
							{page.icon}
						</span>
					) : (
						<FileTextIcon
							className={cn(
								"text-sidebar-foreground/60",
								isMobile && hasChildren && "invisible",
							)}
						/>
					)}
					<span>{page.title || "Untitled"}</span>
				</SidebarMenuButton>
			)}
			{hasChildren && !isRenaming ? (
				// On hover the chevron sits over the page icon, sidebar-10 style.
				<SidebarMenuAction
					showOnHover
					className={cn(
						"left-1 bg-sidebar-accent text-sidebar-accent-foreground transition-transform",
						expanded && "rotate-90",
					)}
					aria-label={expanded ? "Collapse" : "Expand"}
					onClick={() => onExpand()}
				>
					<ChevronRightIcon />
				</SidebarMenuAction>
			) : null}
			{isRenaming ? null : isMobile ? (
				// Mobile: one action button that opens a bottom drawer — bigger
				// tap targets, and no "+" crowding the row.
				<Drawer showSwipeHandle>
					<DrawerTrigger
						render={
							<SidebarMenuAction
								className="right-1 aria-expanded:bg-muted"
								aria-label="Page actions"
							/>
						}
					>
						<MoreHorizontalIcon />
					</DrawerTrigger>
					<DrawerContent>
						<DrawerHeader>
							<DrawerTitle className="truncate">
								{page.icon ? `${page.icon} ` : ""}
								{page.title || "Untitled"}
							</DrawerTitle>
							<DrawerDescription className="sr-only">
								Page actions
							</DrawerDescription>
						</DrawerHeader>
						<div className="flex flex-col p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
							<DrawerClose
								render={
									<Button
										variant="ghost"
										className="h-11 justify-start"
										disabled={favorite.disabled}
										onClick={() => favorite.onToggle()}
									/>
								}
							>
								<StarIcon
									className={favorite.selected ? "fill-current" : undefined}
								/>
								{favorite.selected
									? "Remove from favorites"
									: "Add to favorites"}
							</DrawerClose>
							{canEdit ? (
								<>
									<DrawerClose
										render={
											<Button
												variant="ghost"
												className="h-11 justify-start"
												onClick={() => onCreate()}
												disabled={isCreatingPage}
											/>
										}
									>
										<PlusIcon />
										Add subpage
									</DrawerClose>
									<DrawerClose
										render={
											<Button
												variant="ghost"
												className="h-11 justify-start"
												onClick={() => rename.onStart()}
											/>
										}
									>
										<PencilIcon />
										Rename
									</DrawerClose>
									<DrawerClose
										render={
											<Button
												variant="ghost"
												className="h-11 justify-start"
												onClick={() => onIcon()}
											/>
										}
									>
										<SmilePlusIcon />
										Change icon
									</DrawerClose>
									<DrawerClose
										render={
											<Button
												variant="ghost"
												className="h-11 justify-start text-destructive hover:text-destructive"
												onClick={() => onTrash()}
											/>
										}
									>
										<Trash2Icon />
										Move to trash
									</DrawerClose>
								</>
							) : null}
						</div>
					</DrawerContent>
				</Drawer>
			) : (
				<>
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<SidebarMenuAction
									showOnHover
									className={cn(
										canEdit ? "right-6" : "right-1",
										"aria-expanded:bg-muted",
									)}
									aria-label="Page actions"
								/>
							}
						>
							<MoreHorizontalIcon />
						</DropdownMenuTrigger>
						<DropdownMenuContent
							className="w-48 rounded-lg"
							side="right"
							align="start"
							finalFocus={() => {
								// These dialogs take focus before the menu's exit animation
								// finishes; returning to the row would steal it back.
								if (dialogOpen) {
									return false;
								}
								if (!transferringRenameFocus.current) {
									return true;
								}
								transferringRenameFocus.current = false;
								return false;
							}}
						>
							<DropdownMenuItem
								disabled={favorite.disabled}
								onClick={() => favorite.onToggle()}
							>
								<StarIcon
									className={favorite.selected ? "fill-current" : undefined}
								/>
								{favorite.selected
									? "Remove from favorites"
									: "Add to favorites"}
							</DropdownMenuItem>
							{canEdit ? (
								<>
									<DropdownMenuItem onClick={() => startDesktopRename()}>
										Rename
									</DropdownMenuItem>
									<DropdownMenuItem onClick={() => onIcon()}>
										Change icon
									</DropdownMenuItem>
									<DropdownMenuItem
										className="text-destructive focus:text-destructive"
										onClick={() => onTrash()}
									>
										Move to trash
									</DropdownMenuItem>
								</>
							) : null}
						</DropdownMenuContent>
					</DropdownMenu>
					{canEdit ? (
						<SidebarMenuAction
							showOnHover
							aria-label="Add subpage"
							onClick={() => onCreate()}
							disabled={isCreatingPage}
						>
							<PlusIcon />
						</SidebarMenuAction>
					) : null}
				</>
			)}
		</SidebarMenuItem>
	);
}
