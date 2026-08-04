"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ChevronRightIcon,
	FileTextIcon,
	FileUpIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PlusIcon,
	SmilePlusIcon,
	StarIcon,
	Trash2Icon,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
	Fragment,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { userErrorMessage } from "@/client/error-feedback";
import { useCurrentUser } from "@/components/app-session-provider";
import { useCommand } from "@/components/command-palette/registry";
import { DestructiveConfirmationDialog } from "@/components/destructive-confirmation-dialog";
import {
	ResponsiveDialog,
	ResponsiveDialogFooter,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
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
import { documentRoomId } from "@/features/collab/lib/room";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import {
	focusTitleOnArrival,
	primeTitleKeyboard,
	releaseTitleKeyboardPrime,
} from "@/features/pages/client/new-page-focus";
import {
	createPageMutationOptions,
	deletePageMutationOptions,
	getPageNavigationQueryOptions,
	getPageQueryOptions,
	invalidatePage,
	invalidatePageNavigation,
	invalidatePages,
	invalidateTrash,
	listPagesQueryOptions,
	optimisticallySetPagePlacement,
	optimisticallySetPageTitle,
	projectPageTitleIntoList,
	restorePagePlacementInCache,
	restorePageTitleInCache,
	setFavoriteInNavigationCache,
	setPageFavoriteMutationOptions,
	setPageTitleInCache,
	updatePageMutationOptions,
} from "@/features/pages/client/queries";
import { flushPendingPageSave } from "@/features/pages/client/save-state";
import {
	PAGE_TITLE_MAX_LENGTH,
	PAGE_TITLE_TOO_LONG_MESSAGE,
	type PageMeta,
} from "@/features/pages/schemas";
import { invalidateTasksWhenIdle } from "@/features/tasks/client/queries";
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

const MarkdownImportDialog = dynamic(
	() =>
		import("./markdown-import-dialog").then((mod) => ({
			default: mod.MarkdownImportDialog,
		})),
	{ ssr: false },
);

type TreeNode = PageMeta & { children: TreeNode[] };
const PAGE_TREE_SKELETON_ROWS = [
	"page-tree-a",
	"page-tree-b",
	"page-tree-c",
	"page-tree-d",
];

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
	const currentUser = useCurrentUser();
	const { isMobile, setOpenMobile, setSuppressMobileFinalFocus } = useSidebar();
	const activePageId = pathname.match(/\/p\/([^/]+)/)?.[1] ?? null;
	// Viewers browse the tree but get no create/rename/move/delete controls.
	const canEdit = useCanEditWorkspace();
	const { synced } = useWorkspaceRouteSync(workspaceId);
	const pagesQuery = useQuery({
		...listPagesQueryOptions(workspaceId),
		enabled: synced,
	});
	const navigationQuery = useQuery({
		...getPageNavigationQueryOptions(workspaceId),
		enabled: synced,
	});
	// Observe the same page cache as PageEditor. Its title is projected from the
	// authoritative Yjs document, so it remains current while SQLite catches up.
	const activePageQuery = useQuery({
		...getPageQueryOptions(activePageId ?? ""),
		enabled: synced && activePageId !== null,
	});
	const createMutation = useMutation({
		...createPageMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const updateMutation = useMutation({
		...updatePageMutationOptions(),
		meta: { errorMode: "silent" },
	});
	const renameMutation = useMutation({
		...updatePageMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const deleteMutation = useMutation({
		...deletePageMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const favoriteMutation = useMutation({
		...setPageFavoriteMutationOptions(),
		meta: { errorFallback: "The favorite could not be updated." },
	});

	const { expanded, toggle } = useExpandedState(workspaceId);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState("");
	const [actionError, setActionError] = useState<string | null>(null);
	const [renameError, setRenameError] = useState<{
		pageId: string;
		message: string;
	} | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [iconPageId, setIconPageId] = useState<string | null>(null);
	const [importOpen, setImportOpen] = useState(false);
	const [pageToTrash, setPageToTrash] = useState<TreeNode | null>(null);
	const [dragId, setDragId] = useState<string | null>(null);
	const [dropTarget, setDropTarget] = useState<{
		id: string;
		zone: "before" | "after" | "inside";
	} | null>(null);
	const menuFocusTransferPageId = useRef<string | null>(null);
	const pendingMovePageIds = useRef(new Set<string>());
	const pendingRenamePageIds = useRef(new Set<string>());

	useCommand(
		canEdit && synced
			? {
					id: "page.import-markdown",
					title: "Import Markdown",
					group: "Pages",
					keywords: "upload file note",
					icon: FileUpIcon,
					run: () => setImportOpen(true),
				}
			: null,
	);

	const listedPages = pagesQuery.data?.items ?? [];
	const pages = useMemo(() => {
		const activePage = activePageQuery.data;
		if (!activePage) return listedPages;
		return projectPageTitleIntoList(
			listedPages,
			activePage.id,
			activePage.title,
		);
	}, [listedPages, activePageQuery.data]);
	const { tree, nodesById, subtreeIdsById } = useMemo(
		() => buildTreeIndex(pages),
		[pages],
	);

	async function createPage(parentPageId: string | null) {
		setActionError(null);
		primeTitleKeyboard();
		try {
			if (parentPageId && !(await flushPendingPageSave(parentPageId))) {
				setActionError("Save the current page before creating a subpage.");
				releaseTitleKeyboardPrime();
				return;
			}
		} catch (error) {
			setActionError(
				userErrorMessage(error, "The current page could not be saved."),
			);
			releaseTitleKeyboardPrime();
			return;
		}
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
					await Promise.all([
						invalidatePages(queryClient),
						parentPageId
							? invalidatePage(queryClient, parentPageId)
							: Promise.resolve(),
					]);
					focusTitleOnArrival(page.id);
					// On mobile, close the sheet so the new page is visible.
					if (isMobile) {
						setSuppressMobileFinalFocus(true);
						setOpenMobile(false);
					}
					router.push(`/w/${workspaceId}/p/${page.id}`);
				},
				onError: () => {
					setActionError("The page could not be created. Please try again.");
					setSuppressMobileFinalFocus(false);
					releaseTitleKeyboardPrime();
				},
			},
		);
	}

	async function commitRename(pageId: string) {
		if (renameMutation.isPending || pendingRenamePageIds.current.has(pageId)) {
			return;
		}
		const node = nodesById.get(pageId);
		if (!node) return;
		const title = renameValue.trim();
		if (!title) {
			setRenamingId((current) => (current === pageId ? null : current));
			setRenameError(null);
			return;
		}
		if (title.length > PAGE_TITLE_MAX_LENGTH) {
			setRenameError({ pageId, message: PAGE_TITLE_TOO_LONG_MESSAGE });
			return;
		}
		pendingRenamePageIds.current.add(pageId);
		setRenameError(null);
		let snapshot: Awaited<
			ReturnType<typeof optimisticallySetPageTitle>
		> | null = null;
		try {
			if (!(await flushPendingPageSave(pageId))) {
				setRenameError({
					pageId,
					message: "Save the current page before renaming it.",
				});
				return;
			}
			snapshot = await optimisticallySetPageTitle(
				queryClient,
				workspaceId,
				pageId,
				title,
				{
					previousTitle: node.title,
					previousUpdatedAt: node.updatedAt,
				},
			);
			setRenamingId((current) => (current === pageId ? null : current));
			const page = await renameMutation.mutateAsync({
				path: { id: pageId },
				body: { title },
			});
			setRenameError((current) =>
				current?.pageId === pageId ? null : current,
			);
			setPageTitleInCache(queryClient, page.id, page.title, page.updatedAt);
		} catch (error) {
			if (snapshot) {
				restorePageTitleInCache(
					queryClient,
					pageId,
					title,
					snapshot.previousTitle,
					snapshot.previousUpdatedAt,
				);
			}
			setRenamingId(pageId);
			setRenameError({
				pageId,
				message: userErrorMessage(
					error,
					snapshot
						? "The page could not be renamed."
						: "The current page could not be saved before renaming.",
				),
			});
		} finally {
			pendingRenamePageIds.current.delete(pageId);
			if (snapshot) void invalidatePages(queryClient);
		}
	}

	function startRename(node: TreeNode) {
		if (renameMutation.isPending) return;
		setRenameError(null);
		setRenamingId(node.id);
		setRenameValue(node.title);
	}

	function startDesktopRename(node: TreeNode) {
		// The menu normally restores focus to its trigger after an item is
		// selected. Renaming replaces the row with an autofocus input, so that
		// restoration would immediately blur the input and end the rename.
		menuFocusTransferPageId.current = node.id;
		startRename(node);
	}

	function startTrash(node: TreeNode) {
		setDeleteError(null);
		setPageToTrash(node);
	}

	function toggleFavorite(node: TreeNode) {
		const navigation = navigationQuery.data;
		if (!navigation || favoriteMutation.isPending) return;
		const wasFavorite = navigation.favorites.some(
			(page) => page.id === node.id,
		);
		const nextFavorite = !wasFavorite;
		const previousNavigation = navigation;
		setFavoriteInNavigationCache(
			queryClient,
			workspaceId,
			node,
			nextFavorite ? new Date().toISOString() : null,
		);
		favoriteMutation.mutate(
			{ path: { id: node.id }, body: { favorite: nextFavorite } },
			{
				onSuccess: ({ favoritedAt }) =>
					setFavoriteInNavigationCache(
						queryClient,
						workspaceId,
						node,
						favoritedAt,
					),
				onError: () => {
					if (previousNavigation) {
						queryClient.setQueryData(
							getPageNavigationQueryOptions(workspaceId).queryKey,
							previousNavigation,
						);
					}
				},
				onSettled: () => {
					void queryClient.invalidateQueries({
						queryKey: getPageNavigationQueryOptions(workspaceId).queryKey,
						exact: true,
					});
				},
			},
		);
	}

	// Soft delete: the subtree moves to the workspace trash (restorable).
	function deletePage(node: TreeNode) {
		setDeleteError(null);
		const subtree = subtreeIdsById.get(node.id) ?? new Set([node.id]);
		deleteMutation.mutate(
			{ path: { id: node.id } },
			{
				onSuccess: async () => {
					setPageToTrash(null);
					setDeleteError(null);
					await Promise.all([
						invalidatePages(queryClient),
						invalidatePageNavigation(queryClient, workspaceId),
						invalidateTrash(queryClient),
						// Tasks on trashed pages are filtered out server-side, so the
						// subtree's tasks just left the My Tasks list.
						invalidateTasksWhenIdle(queryClient),
					]);
					if (activePageId && subtree.has(activePageId)) {
						router.push(`/w/${workspaceId}`);
					}
				},
				onError: (error) =>
					setDeleteError(
						userErrorMessage(error, "The page could not be moved to trash."),
					),
			},
		);
	}

	const prefetchPage = useCallback(
		(pageId: string) => {
			if (pageId === activePageId) return;
			void queryClient.prefetchQuery(getPageQueryOptions(pageId));
			// The browser module cache deduplicates repeated pointer intent events.
			void import("./editor/haunter-editor");
		},
		[activePageId, queryClient],
	);

	const preloadPageRoom = useCallback(
		(pageId: string) => {
			if (pageId === activePageId || !currentUser) return;
			// Only start a websocket when intent is strong (focus or press), rather
			// than opening rooms for every row crossed by the pointer.
			void import("@/features/collab/client/liveblocks").then(
				({ preloadRoom }) =>
					preloadRoom(documentRoomId("page", pageId), currentUser.id),
			);
		},
		[activePageId, currentUser],
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

	async function performDrop(
		draggedId: string,
		targetId: string,
		zone: "before" | "after" | "inside",
	) {
		if (pendingMovePageIds.current.has(draggedId)) return;
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

		if (zone === "inside" && !expanded[target.id]) toggle(target.id);
		setActionError(null);
		pendingMovePageIds.current.add(draggedId);
		let snapshot: Awaited<
			ReturnType<typeof optimisticallySetPagePlacement>
		> | null = null;
		try {
			snapshot = await optimisticallySetPagePlacement(
				queryClient,
				draggedId,
				parentPageId,
				position,
			);
			await updateMutation.mutateAsync({
				path: { id: draggedId },
				body: { parentPageId, position },
			});
		} catch (error) {
			if (snapshot) {
				restorePagePlacementInCache(queryClient, draggedId, snapshot);
			}
			setActionError(userErrorMessage(error, "The page could not be moved."));
		} finally {
			pendingMovePageIds.current.delete(draggedId);
			void invalidatePages(queryClient);
		}
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
		const isFavorite = navigationQuery.data?.favorites.some(
			(page) => page.id === node.id,
		);

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
							void performDrop(draggedId, node.id, zoneFromPointer(event));
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
							maxLength={PAGE_TITLE_MAX_LENGTH}
							aria-invalid={renameError?.pageId === node.id ? true : undefined}
							onChange={(event) => {
								setRenameValue(event.target.value);
								setRenameError(null);
							}}
							onKeyDown={(event) => {
								if (event.key === "Enter") void commitRename(node.id);
								if (event.key === "Escape") setRenamingId(null);
							}}
							onBlur={() => void commitRename(node.id)}
						/>
					) : (
						<SidebarMenuButton
							render={
								<Link
									href={`/w/${workspaceId}/p/${node.id}`}
									onFocus={() => {
										prefetchPage(node.id);
										preloadPageRoom(node.id);
									}}
									onPointerDown={() => {
										prefetchPage(node.id);
										preloadPageRoom(node.id);
									}}
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
												disabled={
													!navigationQuery.data || favoriteMutation.isPending
												}
												onClick={() => toggleFavorite(node)}
											/>
										}
									>
										<StarIcon
											className={isFavorite ? "fill-current" : undefined}
										/>
										{isFavorite ? "Remove from favorites" : "Add to favorites"}
									</DrawerClose>
									{canEdit ? (
										<>
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
														onClick={() => startRename(node)}
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
														onClick={() => startTrash(node)}
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
										if (menuFocusTransferPageId.current !== node.id) {
											return true;
										}
										menuFocusTransferPageId.current = null;
										return false;
									}}
								>
									<DropdownMenuItem
										disabled={
											!navigationQuery.data || favoriteMutation.isPending
										}
										onClick={() => toggleFavorite(node)}
									>
										<StarIcon
											className={isFavorite ? "fill-current" : undefined}
										/>
										{isFavorite ? "Remove from favorites" : "Add to favorites"}
									</DropdownMenuItem>
									{canEdit ? (
										<>
											<DropdownMenuItem
												onClick={() => startDesktopRename(node)}
											>
												Rename
											</DropdownMenuItem>
											<DropdownMenuItem onClick={() => setIconPageId(node.id)}>
												Change icon
											</DropdownMenuItem>
											<DropdownMenuItem
												className="text-destructive focus:text-destructive"
												onClick={() => startTrash(node)}
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
									onClick={() => createPage(node.id)}
								>
									<PlusIcon />
								</SidebarMenuAction>
							) : null}
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
				<>
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<SidebarGroupAction
									className="right-12"
									title="More page actions"
									aria-label="More page actions"
								/>
							}
						>
							<MoreHorizontalIcon />
						</DropdownMenuTrigger>
						<DropdownMenuContent className="w-44" side="bottom" align="end">
							<DropdownMenuItem onClick={() => setImportOpen(true)}>
								<FileUpIcon />
								Import Markdown
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<SidebarGroupAction
						title="New page"
						aria-label="New page"
						onClick={() => createPage(null)}
					>
						<PlusIcon />
					</SidebarGroupAction>
				</>
			) : null}
			<SidebarGroupContent>
				{!synced || pagesQuery.isPending ? (
					<div aria-busy="true" aria-live="polite" className="py-1">
						<span className="sr-only">Loading pages</span>
						{PAGE_TREE_SKELETON_ROWS.map((id) => (
							<SidebarMenuSkeleton
								key={id}
								showIcon
								className="opacity-70"
								aria-hidden="true"
							/>
						))}
					</div>
				) : pagesQuery.isError && !pagesQuery.data ? (
					<div className="space-y-2 px-2 py-1 text-xs">
						<p role="alert" className="text-destructive">
							Pages could not be loaded.
						</p>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => void pagesQuery.refetch()}
						>
							Try again
						</Button>
					</div>
				) : tree.length === 0 ? (
					<div className="flex flex-col items-start gap-1 px-2">
						<p className="text-sidebar-foreground/50 text-xs">No pages yet.</p>
					</div>
				) : (
					<SidebarMenu>{tree.map((node) => renderNode(node))}</SidebarMenu>
				)}
			</SidebarGroupContent>
			{actionError ? (
				<p role="alert" className="px-2 text-destructive text-xs">
					{actionError}
				</p>
			) : null}
			{!isMobile && renameError?.pageId === renamingId ? (
				<p role="alert" className="px-2 text-destructive text-xs">
					{renameError.message}
				</p>
			) : null}
			{/* On desktop renaming is inline in the row; on mobile the row is
			    inside the sidebar sheet, so it gets a proper drawer instead. */}
			{isMobile ? (
				<ResponsiveDialog
					open={renamingId !== null}
					onOpenChange={(open) => {
						if (!open) {
							setRenamingId(null);
							setRenameError(null);
						}
					}}
					title="Rename page"
					description="Choose a new name for this page."
				>
					<form
						className="flex flex-col gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							if (renamingId) void commitRename(renamingId);
						}}
					>
						<Input
							autoFocus
							value={renameValue}
							aria-label="Page title"
							aria-invalid={
								renameError?.pageId === renamingId ? true : undefined
							}
							maxLength={PAGE_TITLE_MAX_LENGTH}
							onChange={(event) => {
								setRenameValue(event.target.value);
								setRenameError(null);
							}}
						/>
						{renameError?.pageId === renamingId ? (
							<p role="alert" className="text-destructive text-sm">
								{renameError.message}
							</p>
						) : null}
						<ResponsiveDialogFooter>
							<Button
								type="submit"
								disabled={!renameValue.trim() || renameMutation.isPending}
							>
								Rename
							</Button>
						</ResponsiveDialogFooter>
					</form>
				</ResponsiveDialog>
			) : null}
			{importOpen ? (
				<MarkdownImportDialog
					workspaceId={workspaceId}
					onOpenChange={setImportOpen}
				/>
			) : null}
			<DestructiveConfirmationDialog
				open={pageToTrash !== null}
				onOpenChange={(open) => {
					if (!open) {
						setPageToTrash(null);
						setDeleteError(null);
					}
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
				error={deleteError}
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
