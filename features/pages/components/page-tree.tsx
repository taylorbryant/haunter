"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ChevronRightIcon,
	FileTextIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PlusIcon,
	SmilePlusIcon,
	Trash2Icon,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { DestructiveConfirmationDialog } from "@/components/destructive-confirmation-dialog";
import {
	ResponsiveDialog,
	ResponsiveDialogFooter,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
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
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarInput,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSkeleton,
	SidebarMenuSub,
	useSidebar,
} from "@/components/ui/sidebar";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import {
	createPageMutationOptions,
	deletePageMutationOptions,
	getPageQueryOptions,
	invalidatePages,
	invalidateTrash,
	listPagesQueryOptions,
	updatePageMutationOptions,
} from "@/features/pages/client/queries";
import {
	focusTitleOnArrival,
	primeTitleKeyboard,
	releaseTitleKeyboardPrime,
} from "@/features/pages/client/new-page-focus";
import type { PageMeta } from "@/features/pages/schemas";
import { invalidateTasks } from "@/features/tasks/client/queries";
import { useWorkspaceRouteSync } from "@/features/workspaces/client/use-workspace-route-sync";
import { cn } from "@/lib/utils";

const PageIconPanel = dynamic(
	() =>
		import("./page-icon-panel").then((mod) => ({
			default: mod.PageIconPanel,
		})),
	{
		ssr: false,
		loading: () => <div className="h-[300px] w-[288px]" aria-hidden />,
	},
);

type TreeNode = PageMeta & { children: TreeNode[] };

function buildTree(pages: PageMeta[]): TreeNode[] {
	const nodes = new Map<string, TreeNode>(
		pages.map((page) => [page.id, { ...page, children: [] }]),
	);
	const roots: TreeNode[] = [];

	for (const node of nodes.values()) {
		const parent = node.parentPageId ? nodes.get(node.parentPageId) : null;
		if (parent) {
			parent.children.push(node);
		} else {
			roots.push(node);
		}
	}

	return roots;
}

function buildTreeIndex(pages: PageMeta[]) {
	const tree = buildTree(pages);
	const nodesById = new Map<string, TreeNode>();
	const subtreeIdsById = new Map<string, Set<string>>();

	function visit(node: TreeNode): Set<string> {
		nodesById.set(node.id, node);
		const ids = new Set<string>([node.id]);
		for (const child of node.children) {
			for (const id of visit(child)) {
				ids.add(id);
			}
		}
		subtreeIdsById.set(node.id, ids);
		return ids;
	}

	for (const node of tree) {
		visit(node);
	}

	return { tree, nodesById, subtreeIdsById };
}

function useExpandedState(workspaceId: string) {
	const storageKey = `haunter.tree.${workspaceId}`;
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});

	useEffect(() => {
		try {
			const raw = localStorage.getItem(storageKey);
			setExpanded(raw ? JSON.parse(raw) : {});
		} catch {
			setExpanded({});
		}
	}, [storageKey]);

	const toggle = useCallback(
		(pageId: string) => {
			setExpanded((current) => {
				const next = { ...current, [pageId]: !current[pageId] };
				try {
					localStorage.setItem(storageKey, JSON.stringify(next));
				} catch {
					// localStorage unavailable; expansion is session-only.
				}
				return next;
			});
		},
		[storageKey],
	);

	return { expanded, toggle };
}

export function PageTree({ workspaceId }: { workspaceId: string }) {
	const router = useRouter();
	const pathname = usePathname();
	const queryClient = useQueryClient();
	const { isMobile, setOpenMobile, setSuppressMobileFinalFocus } = useSidebar();
	// Viewers browse the tree but get no create/rename/move/delete controls.
	const canEdit = useCanEditWorkspace();
	const { synced } = useWorkspaceRouteSync(workspaceId);
	const pagesQuery = useQuery({
		...listPagesQueryOptions(workspaceId),
		enabled: synced,
	});
	const createMutation = useMutation(createPageMutationOptions());
	const updateMutation = useMutation(updatePageMutationOptions());
	const deleteMutation = useMutation(deletePageMutationOptions());

	const { expanded, toggle } = useExpandedState(workspaceId);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState("");
	const [iconPageId, setIconPageId] = useState<string | null>(null);
	const [pageToTrash, setPageToTrash] = useState<TreeNode | null>(null);
	const [dragId, setDragId] = useState<string | null>(null);
	const [dropTarget, setDropTarget] = useState<{
		id: string;
		zone: "before" | "after" | "inside";
	} | null>(null);

	const pages = pagesQuery.data?.items ?? [];
	const { tree, nodesById, subtreeIdsById } = useMemo(
		() => buildTreeIndex(pages),
		[pages],
	);
	const activePageId = pathname.match(/\/p\/([^/]+)/)?.[1] ?? null;

	function createPage(parentPageId: string | null) {
		primeTitleKeyboard();
		createMutation.mutate(
			{
				body: {
					workspaceId,
					title: "",
					...(parentPageId ? { parentPageId } : {}),
				},
			},
			{
				onSuccess: async (page) => {
					if (parentPageId && !expanded[parentPageId]) toggle(parentPageId);
					await invalidatePages(queryClient);
					focusTitleOnArrival(page.id);
					// On mobile, close the sheet so the new page is visible.
					if (isMobile) {
						setSuppressMobileFinalFocus(true);
						setOpenMobile(false);
					}
					router.push(`/w/${workspaceId}/p/${page.id}`);
				},
				onError: () => {
					setSuppressMobileFinalFocus(false);
					releaseTitleKeyboardPrime();
				},
			},
		);
	}

	function commitRename(pageId: string) {
		const title = renameValue.trim();
		setRenamingId(null);
		if (!title) return;
		updateMutation.mutate(
			{ path: { id: pageId }, body: { title } },
			{ onSuccess: () => invalidatePages(queryClient) },
		);
	}

	// Soft delete: the subtree moves to the workspace trash (restorable).
	function deletePage(node: TreeNode) {
		const subtree = subtreeIdsById.get(node.id) ?? new Set([node.id]);
		deleteMutation.mutate(
			{ path: { id: node.id } },
			{
				onSuccess: async () => {
					setPageToTrash(null);
					await Promise.all([
						invalidatePages(queryClient),
						invalidateTrash(queryClient),
						// Tasks on trashed pages are filtered out server-side, so the
						// subtree's tasks just left the My Tasks list.
						invalidateTasks(queryClient),
					]);
					if (activePageId && subtree.has(activePageId)) {
						router.push(`/w/${workspaceId}`);
					}
				},
			},
		);
	}

	const prefetchPage = useCallback(
		(pageId: string) => {
			if (pageId === activePageId) return;
			void queryClient.prefetchQuery(getPageQueryOptions(pageId));
		},
		[activePageId, queryClient],
	);

	function siblingsOf(parentId: string | null): TreeNode[] {
		return parentId === null ? tree : (nodesById.get(parentId)?.children ?? []);
	}

	function canDropOn(targetId: string): boolean {
		if (!dragId || dragId === targetId) return false;
		const dragged = nodesById.get(dragId);
		// A page cannot be dropped into its own subtree.
		return (
			Boolean(dragged) &&
			!(subtreeIdsById.get((dragged as TreeNode).id) ?? new Set()).has(targetId)
		);
	}

	function performDrop(
		draggedId: string,
		targetId: string,
		zone: "before" | "after" | "inside",
	) {
		const dragged = nodesById.get(draggedId);
		const target = nodesById.get(targetId);
		if (!dragged || !target || !canDropOn(targetId)) return;

		let parentPageId: string | null;
		let position: number;

		if (zone === "inside") {
			parentPageId = target.id;
			position =
				target.children
					.filter((child) => child.id !== draggedId)
					.reduce((max, child) => Math.max(max, child.position), 0) + 1;
		} else {
			parentPageId = target.parentPageId;
			const siblings = siblingsOf(parentPageId).filter(
				(sibling) => sibling.id !== draggedId,
			);
			const index = siblings.findIndex((sibling) => sibling.id === targetId);
			if (index === -1) return;
			if (zone === "before") {
				const prev = siblings[index - 1];
				position = prev
					? (prev.position + target.position) / 2
					: target.position - 1;
			} else {
				const next = siblings[index + 1];
				position = next
					? (target.position + next.position) / 2
					: target.position + 1;
			}
		}

		if (
			parentPageId === dragged.parentPageId &&
			position === dragged.position
		) {
			return;
		}

		updateMutation.mutate(
			{ path: { id: draggedId }, body: { parentPageId, position } },
			{ onSuccess: () => invalidatePages(queryClient) },
		);
		if (zone === "inside" && !expanded[target.id]) toggle(target.id);
	}

	function zoneFromPointer(
		event: React.DragEvent<HTMLLIElement>,
	): "before" | "after" | "inside" {
		const rect = event.currentTarget.getBoundingClientRect();
		const ratio = (event.clientY - rect.top) / rect.height;
		if (ratio < 0.3) return "before";
		if (ratio > 0.7) return "after";
		return "inside";
	}

	function renderNode(node: TreeNode) {
		const isExpanded = Boolean(expanded[node.id]);
		const isActive = node.id === activePageId;
		// Mobile renames happen in the drawer below, not inline in the row.
		const isRenaming = node.id === renamingId && !isMobile;
		const hasChildren = node.children.length > 0;

		return (
			// The children live in a SIBLING <li>, not inside the row's
			// SidebarMenuItem: showOnHover keys off group-hover/menu-item, and
			// nesting would reveal the parent's actions while hovering any child.
			<Fragment key={node.id}>
				<SidebarMenuItem
					draggable={canEdit && !isRenaming}
					className={cn(
						dragId === node.id && "opacity-50",
						dropTarget?.id === node.id &&
							dropTarget.zone === "inside" &&
							"rounded-md ring-2 ring-primary/60",
						dropTarget?.id === node.id &&
							dropTarget.zone === "before" &&
							"shadow-[0_-2px_0_0_var(--primary)]",
						dropTarget?.id === node.id &&
							dropTarget.zone === "after" &&
							"shadow-[0_2px_0_0_var(--primary)]",
					)}
					onDragStart={(event) => {
						event.stopPropagation();
						event.dataTransfer.setData("text/plain", node.id);
						event.dataTransfer.effectAllowed = "move";
						setDragId(node.id);
					}}
					onDragEnd={() => {
						setDragId(null);
						setDropTarget(null);
					}}
					onDragOver={(event) => {
						if (!canDropOn(node.id)) return;
						event.preventDefault();
						event.stopPropagation();
						event.dataTransfer.dropEffect = "move";
						const zone = zoneFromPointer(event);
						setDropTarget((current) =>
							current?.id === node.id && current.zone === zone
								? current
								: { id: node.id, zone },
						);
					}}
					onDragLeave={() => {
						setDropTarget((current) =>
							current?.id === node.id ? null : current,
						);
					}}
					onDrop={(event) => {
						event.preventDefault();
						event.stopPropagation();
						const draggedId =
							event.dataTransfer.getData("text/plain") || dragId;
						if (draggedId) {
							performDrop(draggedId, node.id, zoneFromPointer(event));
						}
						setDragId(null);
						setDropTarget(null);
					}}
				>
					{isRenaming ? (
						<SidebarInput
							autoFocus
							className="h-8"
							value={renameValue}
							onChange={(event) => setRenameValue(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") commitRename(node.id);
								if (event.key === "Escape") setRenamingId(null);
							}}
							onBlur={() => commitRename(node.id)}
						/>
					) : (
						<SidebarMenuButton
							render={
								<Link
									href={`/w/${workspaceId}/p/${node.id}`}
									onFocus={() => prefetchPage(node.id)}
									onPointerDown={() => prefetchPage(node.id)}
									onPointerEnter={() => prefetchPage(node.id)}
									// On mobile, tapping a page navigates and closes the
									// sidebar sheet so the page is visible immediately.
									onClick={() => {
										if (isMobile) setOpenMobile(false);
									}}
								/>
							}
							isActive={isActive}
							title={node.title}
							// Two hover actions sit on the right (••• at right-6, + at
							// right-1); the default pr-8 clearance lets text run under
							// them, so widen it.
							className="group-has-data-[sidebar=menu-action]/menu-item:pr-13"
						>
							{/* On mobile the expand chevron is always shown (no hover)
							    and sits over this icon slot; keep the slot but hide the
							    glyph so the chevron doesn't overlap the emoji. */}
							{node.icon ? (
								<span className={cn(isMobile && hasChildren && "invisible")}>
									{node.icon}
								</span>
							) : (
								<FileTextIcon
									className={cn(
										"text-sidebar-foreground/60",
										isMobile && hasChildren && "invisible",
									)}
								/>
							)}
							<span>{node.title || "Untitled"}</span>
						</SidebarMenuButton>
					)}
					{hasChildren && !isRenaming ? (
						// On hover the chevron sits over the page icon, sidebar-10 style.
						<SidebarMenuAction
							showOnHover
							className={cn(
								"left-1 bg-sidebar-accent text-sidebar-accent-foreground transition-transform",
								isExpanded && "rotate-90",
							)}
							aria-label={isExpanded ? "Collapse" : "Expand"}
							onClick={() => toggle(node.id)}
						>
							<ChevronRightIcon />
						</SidebarMenuAction>
					) : null}
					{!canEdit || isRenaming ? null : isMobile ? (
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
										{node.icon ? `${node.icon} ` : ""}
										{node.title || "Untitled"}
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
												onClick={() => createPage(node.id)}
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
												onClick={() => {
													setRenamingId(node.id);
													setRenameValue(node.title);
												}}
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
												onClick={() => setIconPageId(node.id)}
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
												onClick={() => setPageToTrash(node)}
											/>
										}
									>
										<Trash2Icon />
										Move to trash
									</DrawerClose>
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
											className="right-6 aria-expanded:bg-muted"
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
								>
									<DropdownMenuItem
										onClick={() => {
											setRenamingId(node.id);
											setRenameValue(node.title);
										}}
									>
										Rename
									</DropdownMenuItem>
									<DropdownMenuItem onClick={() => setIconPageId(node.id)}>
										Change icon
									</DropdownMenuItem>
									<DropdownMenuItem
										className="text-destructive focus:text-destructive"
										onClick={() => setPageToTrash(node)}
									>
										Move to trash
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
							<SidebarMenuAction
								showOnHover
								aria-label="Add subpage"
								onClick={() => createPage(node.id)}
							>
								<PlusIcon />
							</SidebarMenuAction>
						</>
					)}
				</SidebarMenuItem>
				{isExpanded && hasChildren ? (
					<li>
						<SidebarMenuSub className="mr-0 pr-0">
							{node.children.map((child) => renderNode(child))}
						</SidebarMenuSub>
					</li>
				) : null}
			</Fragment>
		);
	}

	return (
		<SidebarGroup>
			<SidebarGroupLabel>Pages</SidebarGroupLabel>
			{canEdit && synced ? (
				<SidebarGroupAction
					title="New page"
					aria-label="New page"
					onClick={() => createPage(null)}
				>
					<PlusIcon />
				</SidebarGroupAction>
			) : null}
			<SidebarGroupContent>
				{!synced || pagesQuery.isPending ? (
					<div aria-busy="true" aria-live="polite" className="py-1">
						<span className="sr-only">Loading pages</span>
						{[0, 1, 2, 3].map((index) => (
							<SidebarMenuSkeleton
								key={index}
								showIcon
								className="opacity-70"
								aria-hidden="true"
							/>
						))}
					</div>
				) : tree.length === 0 ? (
					<p className="px-2 text-sidebar-foreground/50 text-xs">
						{canEdit ? "No pages yet. Create one." : "No pages yet."}
					</p>
				) : (
					<SidebarMenu>{tree.map((node) => renderNode(node))}</SidebarMenu>
				)}
			</SidebarGroupContent>
			{/* On desktop renaming is inline in the row; on mobile the row is
			    inside the sidebar sheet, so it gets a proper drawer instead. */}
			{isMobile ? (
				<ResponsiveDialog
					open={renamingId !== null}
					onOpenChange={(open) => {
						if (!open) setRenamingId(null);
					}}
					title="Rename page"
					description="Choose a new name for this page."
				>
					<form
						className="flex flex-col gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							if (renamingId) commitRename(renamingId);
						}}
					>
						<Input
							autoFocus
							value={renameValue}
							aria-label="Page title"
							onChange={(event) => setRenameValue(event.target.value)}
						/>
						<ResponsiveDialogFooter>
							<Button type="submit" disabled={!renameValue.trim()}>
								Rename
							</Button>
						</ResponsiveDialogFooter>
					</form>
				</ResponsiveDialog>
			) : null}
			<DestructiveConfirmationDialog
				open={pageToTrash !== null}
				onOpenChange={(open) => {
					if (!open) setPageToTrash(null);
				}}
				title="Move to trash?"
				description={
					<span className="break-words">
						Move {pageToTrash?.title || "Untitled"}{" "}
						{pageToTrash && pageToTrash.children.length > 0
							? "and its subpages "
							: ""}
						to trash? You can restore it later from Trash.
					</span>
				}
				actionLabel="Move to trash"
				pendingLabel="Moving…"
				pending={deleteMutation.isPending}
				onConfirm={() => {
					if (pageToTrash) deletePage(pageToTrash);
				}}
			/>
			<Dialog
				open={iconPageId !== null}
				onOpenChange={(open) => !open && setIconPageId(null)}
			>
				<DialogContent className="w-auto p-0">
					<DialogHeader className="sr-only">
						<DialogTitle>Change page icon</DialogTitle>
					</DialogHeader>
					{iconPageId ? (
						<PageIconPanel
							pageId={iconPageId}
							hasIcon={nodesById.get(iconPageId)?.icon != null}
							onDone={() => setIconPageId(null)}
						/>
					) : null}
				</DialogContent>
			</Dialog>
		</SidebarGroup>
	);
}
