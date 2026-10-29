"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	FileUpIcon,
	LoaderCircleIcon,
	MoreHorizontalIcon,
	PlusIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useWorkspacePathname as usePathname } from "@/client/workspace-navigation";
import { useDraftSafeRouter as useRouter } from "@/client/use-draft-safe-router";
import {
	Fragment,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useTransition,
} from "react";
import { userErrorMessage } from "@/client/error-feedback";
import { useCommand } from "@/components/command-palette/registry";
import { Button } from "@/components/ui/button";
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
	SidebarMenu,
	SidebarMenuSkeleton,
	SidebarMenuSub,
	useSidebar,
} from "@/components/ui/sidebar";
import { PageTreeRow } from "./page-tree-row";
import {
	PageIconDialog,
	PageRenameDialog,
	PageTrashDialog,
} from "./page-tree-dialogs";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import {
	focusTitleOnArrival,
	primeTitleKeyboard,
	releaseTitleKeyboardPrime,
} from "@/features/pages/client/new-page-focus";
import {
	buildPageTreeIndex,
	type PageTreeNode,
} from "@/features/pages/client/page-tree-controller";
import { preloadHaunterEditor } from "@/features/pages/client/preload-editor";
import {
	createPageMutationOptions,
	reconcileCreatedPage,
	getPageNavigationQueryOptions,
	listPagesQueryOptions,
} from "@/features/pages/client/queries";
import { flushPendingPageSave } from "@/features/pages/client/save-state";
import { usePageTreeRename } from "@/features/pages/client/use-page-tree-rename";
import { usePageTreeMove } from "@/features/pages/client/use-page-tree-move";
import { usePageFavorite } from "@/features/pages/client/use-page-favorite";
import {
	pageTrashDestination,
	pageTrashErrorMessage,
	usePageTrash,
} from "@/features/pages/client/use-page-trash";
import { useWorkspaceRouteSync } from "@/features/workspaces/client/use-workspace-route-sync";

const RecoveryImportDialog = dynamic(
	() =>
		import("@/features/documents/components/recovery-import-dialog").then(
			(mod) => ({ default: mod.RecoveryImportDialog }),
		),
	{ ssr: false },
);

const MarkdownImportDialog = dynamic(
	() =>
		import("./markdown-import-dialog").then((mod) => ({
			default: mod.MarkdownImportDialog,
		})),
	{ ssr: false },
);

const PAGE_TREE_SKELETON_ROWS = [
	"page-tree-a",
	"page-tree-b",
	"page-tree-c",
	"page-tree-d",
];

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

export function PageTree({
	workspaceId,
	allowImports = true,
	allowRecovery = allowImports,
	allowFavorites = true,
	beforeRemove,
	onRemoved,
}: {
	workspaceId: string;
	allowImports?: boolean;
	allowRecovery?: boolean;
	allowFavorites?: boolean;
	beforeRemove?: () => Promise<boolean>;
	onRemoved?: (pageIds: readonly string[]) => boolean;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const currentPathnameRef = useRef(pathname);
	currentPathnameRef.current = pathname;
	const queryClient = useQueryClient();
	const { isMobile, setOpenMobile, setSuppressMobileFinalFocus } = useSidebar();
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
	const createMutation = useMutation({
		...createPageMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const trash = usePageTrash();
	const favorite = usePageFavorite(workspaceId);

	const { expanded, toggle } = useExpandedState(workspaceId);
	const [actionError, setActionError] = useState<string | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [iconPageId, setIconPageId] = useState<string | null>(null);
	const [importOpen, setImportOpen] = useState(false);
	const [recoveryOpen, setRecoveryOpen] = useState(false);
	const [pageToTrash, setPageToTrash] = useState<PageTreeNode | null>(null);
	const creatingPage = useRef(false);
	const [isCreatingPage, startCreatingPage] = useTransition();

	useCommand(
		canEdit && synced && allowImports
			? {
					id: "page.import-markdown",
					opensDialog: true,
					title: "Import Markdown",
					group: "Pages",
					keywords: "upload file note",
					icon: FileUpIcon,
					run: () => setImportOpen(true),
				}
			: null,
	);

	useCommand(
		canEdit && synced && allowRecovery
			? {
					id: "page.recover-drafts",
					opensDialog: true,
					title: "Recover drafts",
					group: "Pages",
					keywords: "import recovery backup json",
					icon: FileUpIcon,
					run: () => setRecoveryOpen(true),
				}
			: null,
	);

	const pages = pagesQuery.data?.items ?? [];
	const index = useMemo(() => buildPageTreeIndex(pages), [pages]);
	const { tree, nodesById } = index;
	const rename = usePageTreeRename({ workspaceId, nodesById });
	const move = usePageTreeMove({
		index,
		expanded,
		onExpand: toggle,
		onError: setActionError,
	});
	const activePageId = pathname.match(/\/p\/([^/]+)/)?.[1] ?? null;

	function createPage(parentPageId: string | null) {
		if (creatingPage.current || isCreatingPage || !synced) return;
		creatingPage.current = true;
		setActionError(null);
		primeTitleKeyboard();
		startCreatingPage(async () => {
			try {
				if (parentPageId && !(await flushPendingPageSave(parentPageId))) {
					throw new Error("Save the current page before creating a subpage.");
				}
				const page = await createMutation.mutateAsync({
					body: {
						workspaceId,
						title: "",
						...(parentPageId ? { parentPageId } : {}),
					},
				});
				reconcileCreatedPage(queryClient, page);
				if (parentPageId && !expanded[parentPageId]) toggle(parentPageId);
				focusTitleOnArrival(page.id);
				if (isMobile) {
					setSuppressMobileFinalFocus(true);
					setOpenMobile(false);
				}
				startCreatingPage(() => {
					router.push(`/w/${workspaceId}/p/${page.id}`);
				});
			} catch (error) {
				setActionError(
					userErrorMessage(
						error,
						"The page could not be created. Please try again.",
					),
				);
				setSuppressMobileFinalFocus(false);
				releaseTitleKeyboardPrime();
			} finally {
				creatingPage.current = false;
			}
		});
	}

	function startTrash(node: PageTreeNode) {
		setDeleteError(null);
		setPageToTrash(node);
	}

	function toggleFavorite(node: PageTreeNode) {
		const navigation = navigationQuery.data;
		if (!navigation || favorite.isPending) return;
		const wasFavorite = navigation.favorites.some(
			(page) => page.id === node.id,
		);
		favorite.toggle(node.id, !wasFavorite);
	}

	// Soft delete: the subtree moves to the workspace trash (restorable).
	async function deletePage(node: PageTreeNode) {
		if (trash.isPending) return;
		setDeleteError(null);
		try {
			const result = await trash.moveToTrash({
				workspaceId,
				pageId: node.id,
				beforeRemove,
				onRemoved: (pageIds) => {
					setPageToTrash(null);
					setDeleteError(null);
					return onRemoved?.(pageIds) ?? false;
				},
			});
			if (!result || result.handled) return;
			const destination = pageTrashDestination(
				currentPathnameRef.current,
				workspaceId,
				result.pageIds,
			);
			if (destination) router.push(destination);
		} catch (error) {
			setDeleteError(pageTrashErrorMessage(error));
		}
	}

	const prefetchPage = useCallback(
		(pageId: string) => {
			if (pageId === activePageId) return;
			const href = `/w/${workspaceId}/p/${pageId}`;
			router.prefetch(href);
			void preloadHaunterEditor().catch(() => undefined);
		},
		[activePageId, router, workspaceId],
	);

	function renderNode(node: PageTreeNode) {
		const isExpanded = Boolean(expanded[node.id]);
		return (
			// Keep children in a sibling <li> so child actions do not reveal the parent's hover actions.
			<Fragment key={node.id}>
				<PageTreeRow
					page={node}
					workspaceId={workspaceId}
					active={node.id === activePageId}
					expanded={isExpanded}
					hasChildren={node.children.length > 0}
					canEdit={canEdit}
					isCreatingPage={isCreatingPage}
					dialogOpen={iconPageId === node.id || pageToTrash?.id === node.id}
					favorite={{
						selected:
							navigationQuery.data?.favorites.some(
								(page) => page.id === node.id,
							) ?? false,
						disabled:
							!allowFavorites || !navigationQuery.data || favorite.isPending,
						onToggle: () => toggleFavorite(node),
					}}
					rename={{
						active: rename.pageId === node.id,
						value: rename.value,
						invalid: rename.error?.pageId === node.id,
						onStart: () => rename.start(node),
						onChange: rename.change,
						onCommit: () => void rename.commit(node.id),
						onCancel: rename.cancel,
					}}
					drag={{
						active: move.dragId === node.id,
						targetZone:
							move.dropTarget?.id === node.id ? move.dropTarget.zone : null,
						canDrop: move.canDropOn(node.id),
						draggedId: move.dragId,
						onStart: () => move.startDrag(node.id),
						onEnd: move.endDrag,
						onHover: (zone) => move.hover(node.id, zone),
						onLeave: () => move.leave(node.id),
						onDrop: (draggedId, zone) =>
							void move.commit(draggedId, node.id, zone),
					}}
					onExpand={() => toggle(node.id)}
					onCreate={() => createPage(node.id)}
					onIcon={() => setIconPageId(node.id)}
					onTrash={() => startTrash(node)}
					onPrefetch={() => prefetchPage(node.id)}
				/>
				{isExpanded && node.children.length > 0 ? (
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
							<DropdownMenuItem
								disabled={!allowRecovery}
								onClick={() => setRecoveryOpen(true)}
							>
								<FileUpIcon />
								Recover drafts
							</DropdownMenuItem>
							<DropdownMenuItem
								disabled={!allowImports}
								onClick={() => setImportOpen(true)}
							>
								<FileUpIcon />
								Import Markdown
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<SidebarGroupAction
						title="New page"
						aria-label="New page"
						aria-busy={isCreatingPage}
						onClick={() => createPage(null)}
						disabled={isCreatingPage || !synced}
					>
						{isCreatingPage ? (
							<LoaderCircleIcon className="animate-spin" />
						) : (
							<PlusIcon />
						)}
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
			{isCreatingPage ? (
				<p role="status" className="sr-only">
					Creating page…
				</p>
			) : null}
			{actionError ? (
				<p role="alert" className="px-2 text-destructive text-xs">
					{actionError}
				</p>
			) : null}
			{!isMobile && rename.error?.pageId === rename.pageId ? (
				<p role="alert" className="px-2 text-destructive text-xs">
					{rename.error.message}
				</p>
			) : null}
			{/* On desktop renaming is inline in the row; on mobile the row is
			    inside the sidebar sheet, so it gets a proper drawer instead. */}
			{isMobile ? (
				<PageRenameDialog
					open={rename.pageId !== null}
					value={rename.value}
					error={
						rename.error?.pageId === rename.pageId ? rename.error.message : null
					}
					pending={rename.isPending}
					onChange={rename.change}
					onCancel={rename.cancel}
					onSubmit={() => {
						if (rename.pageId) void rename.commit(rename.pageId);
					}}
				/>
			) : null}
			{recoveryOpen ? (
				<RecoveryImportDialog
					workspaceId={workspaceId}
					onOpenChange={setRecoveryOpen}
				/>
			) : null}
			{importOpen ? (
				<MarkdownImportDialog
					workspaceId={workspaceId}
					onOpenChange={setImportOpen}
				/>
			) : null}
			<PageTrashDialog
				page={pageToTrash}
				pending={trash.isPending}
				error={deleteError}
				onCancel={() => {
					setPageToTrash(null);
					setDeleteError(null);
				}}
				onConfirm={() => {
					if (pageToTrash) void deletePage(pageToTrash);
				}}
			/>
			<PageIconDialog
				pageId={iconPageId}
				hasIcon={iconPageId ? nodesById.get(iconPageId)?.icon != null : false}
				onClose={() => setIconPageId(null)}
			/>
		</SidebarGroup>
	);
}
