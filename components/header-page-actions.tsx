"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	DownloadIcon,
	FileCode2Icon,
	MoreHorizontalIcon,
	Share2Icon,
	StarIcon,
	Trash2Icon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { reportUserError, userErrorMessage } from "@/client/error-feedback";
import { DestructiveConfirmationDialog } from "@/components/destructive-confirmation-dialog";
import { ResponsiveDialog } from "@/components/responsive-dialog";
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
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import {
	downloadPageHtml,
	HtmlExportError,
	pageHtmlSourceUrl,
} from "@/features/pages/client/html-files";
import { downloadPageMarkdown } from "@/features/pages/client/markdown-files";
import {
	deletePageMutationOptions,
	getPageNavigationQueryOptions,
	getPageQueryOptions,
	invalidatePageNavigation,
	invalidatePages,
	invalidateTrash,
	listPagesQueryOptions,
} from "@/features/pages/client/queries";
import { flushPendingPageSave } from "@/features/pages/client/save-state";
import { usePageFavorite } from "@/features/pages/client/use-page-favorite";
import type { PageMeta } from "@/features/pages/schemas";
import { invalidateTasks } from "@/features/tasks/client/queries";
import { useWorkspaceRouteSync } from "@/features/workspaces/client/use-workspace-route-sync";
import { useIsMobile } from "@/hooks/use-mobile";

const SharePanel = dynamic(
	() =>
		import("@/features/shares/components/share-button").then(
			(mod) => mod.SharePanel,
		),
	{
		ssr: false,
		loading: () => <p className="text-muted-foreground text-sm">Loading...</p>,
	},
);

/** Page-scoped actions shared by the desktop menu and mobile drawer. */
export function HeaderPageActions() {
	const pathname = usePathname();
	const router = useRouter();
	const queryClient = useQueryClient();
	const { resolvedTheme } = useTheme();
	const workspaceId = pathname.match(/^\/w\/([^/]+)/)?.[1] ?? null;
	const pageId = pathname.match(/\/p\/([^/]+)/)?.[1] ?? null;
	const { synced } = useWorkspaceRouteSync(workspaceId);
	const canEdit = useCanEditWorkspace();
	const isMobile = useIsMobile();
	const pageQuery = useQuery({
		...getPageQueryOptions(pageId ?? ""),
		enabled: Boolean(pageId && synced),
	});
	const navigationQuery = useQuery({
		...getPageNavigationQueryOptions(workspaceId ?? ""),
		enabled: Boolean(workspaceId && synced),
	});
	const favorite = usePageFavorite(workspaceId ?? "", pageQuery.data);
	const isFavorite = navigationQuery.data?.favorites.some(
		(item) => item.id === pageId,
	);
	const deleteMutation = useMutation({
		...deletePageMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const [sharePageId, setSharePageId] = useState<string | null>(null);
	const [exporting, setExporting] = useState<"markdown" | "html" | null>(null);
	const [trashTarget, setTrashTarget] = useState<{
		pageId: string;
		workspaceId: string;
		title: string;
	} | null>(null);
	const [preparingTrash, setPreparingTrash] = useState(false);
	const [trashError, setTrashError] = useState<string | null>(null);
	const currentPageIdRef = useRef(pageId);
	currentPageIdRef.current = pageId;

	// biome-ignore lint/correctness/useExhaustiveDependencies: close page-scoped dialogs whenever the route identity changes
	useEffect(() => {
		setSharePageId(null);
		setTrashTarget(null);
		setTrashError(null);
	}, [pageId, workspaceId]);

	if (!pageId || !workspaceId || !synced) return null;

	const activePageId = pageId;
	const activeWorkspaceId = workspaceId;
	const trashPending = preparingTrash || deleteMutation.isPending;

	async function exportPage(format: "markdown" | "html") {
		if (exporting) return;
		setExporting(format);
		const sourceUrl = pageHtmlSourceUrl(
			window.location.origin,
			activeWorkspaceId,
			activePageId,
		);
		try {
			if (!(await flushPendingPageSave(activePageId))) {
				reportUserError("Save this page before exporting it.");
				return;
			}
			// Query the page captured when Export was clicked. The header persists
			// across route changes, so its live observer may now point at another page.
			const freshPageQuery = getPageQueryOptions(activePageId);
			// Do not reuse a background request that started before the flush; its
			// response can be a valid but stale snapshot of the exported page.
			const freshPageListQuery =
				format === "html" ? listPagesQueryOptions(activeWorkspaceId) : null;
			const cachedPageList = freshPageListQuery
				? queryClient.getQueryData<{ items: PageMeta[] }>(
						freshPageListQuery.queryKey,
					)
				: null;
			await Promise.all([
				queryClient.cancelQueries(
					{ queryKey: freshPageQuery.queryKey, exact: true },
					{ revert: false, silent: true },
				),
				freshPageListQuery
					? queryClient.cancelQueries(
							{ queryKey: freshPageListQuery.queryKey, exact: true },
							{ revert: false, silent: true },
						)
					: Promise.resolve(),
			]);
			const [refreshed, pageList] = await Promise.all([
				queryClient.fetchQuery({
					...freshPageQuery,
					staleTime: 0,
					meta: {
						...freshPageQuery.meta,
						errorMode: "silent",
					},
				}),
				freshPageListQuery
					? queryClient
							.fetchQuery({
								...freshPageListQuery,
								staleTime: 0,
								meta: {
									...freshPageListQuery.meta,
									errorMode: "silent",
								},
							})
							.catch(() => cachedPageList)
					: Promise.resolve(null),
			]);
			if (format === "markdown") {
				downloadPageMarkdown(refreshed.title, refreshed.content);
			} else {
				await downloadPageHtml({
					title: refreshed.title,
					icon: refreshed.icon,
					content: refreshed.content,
					resolvedTheme,
					sourceUrl,
					pageReferences: pageList?.items ?? [],
				});
			}
		} catch (error) {
			reportUserError(
				error instanceof HtmlExportError ? error.message : error,
				"The page could not be exported.",
			);
		} finally {
			setExporting(null);
		}
	}

	async function moveToTrash() {
		const target = trashTarget;
		if (trashPending || !target) return;
		setTrashError(null);
		setPreparingTrash(true);
		try {
			if (!(await flushPendingPageSave(target.pageId))) {
				setTrashError("Save this page before moving it to trash.");
				return;
			}
			await deleteMutation.mutateAsync({ path: { id: target.pageId } });
			setTrashTarget(null);
			await Promise.all([
				invalidatePages(queryClient),
				invalidatePageNavigation(queryClient, target.workspaceId),
				invalidateTrash(queryClient),
				invalidateTasks(queryClient),
			]);
			if (currentPageIdRef.current === target.pageId) {
				router.push(`/w/${target.workspaceId}`);
			}
		} catch (error) {
			setTrashError(
				userErrorMessage(error, "The page could not be moved to trash."),
			);
		} finally {
			setPreparingTrash(false);
		}
	}

	return (
		<>
			<Button
				variant="ghost"
				size="icon-sm"
				className="text-muted-foreground"
				aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
				title={isFavorite ? "Remove from favorites" : "Add to favorites"}
				disabled={
					!pageQuery.data || !navigationQuery.data || favorite.isPending
				}
				onClick={() => favorite.toggle(!isFavorite)}
			>
				<StarIcon className={isFavorite ? "fill-current" : undefined} />
			</Button>

			{!canEdit ? null : isMobile ? (
				<Drawer showSwipeHandle>
					<DrawerTrigger
						render={
							<Button
								variant="ghost"
								size="icon-sm"
								className="text-muted-foreground"
								aria-label="Page actions"
							/>
						}
					>
						<MoreHorizontalIcon />
					</DrawerTrigger>
					<DrawerContent>
						<DrawerHeader>
							<DrawerTitle>Actions</DrawerTitle>
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
										onClick={() => setSharePageId(activePageId)}
									/>
								}
							>
								<Share2Icon />
								Share
							</DrawerClose>
							<DrawerClose
								render={
									<Button
										variant="ghost"
										className="h-11 justify-start"
										disabled={exporting !== null}
										onClick={() => void exportPage("markdown")}
									/>
								}
							>
								<DownloadIcon />
								{exporting === "markdown" ? "Exporting…" : "Export Markdown"}
							</DrawerClose>
							<DrawerClose
								render={
									<Button
										variant="ghost"
										className="h-11 justify-start"
										disabled={exporting !== null}
										onClick={() => void exportPage("html")}
									/>
								}
							>
								<FileCode2Icon />
								{exporting === "html" ? "Exporting…" : "Export HTML"}
							</DrawerClose>
							<DrawerClose
								render={
									<Button
										variant="ghost"
										className="h-11 justify-start text-destructive hover:text-destructive"
										onClick={() => {
											setTrashError(null);
											setTrashTarget({
												pageId: activePageId,
												workspaceId: activeWorkspaceId,
												title: pageQuery.data?.title || "Untitled",
											});
										}}
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
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								variant="ghost"
								size="icon-sm"
								className="text-muted-foreground"
								aria-label="Page actions"
							/>
						}
					>
						<MoreHorizontalIcon />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-48">
						<DropdownMenuGroup>
							<DropdownMenuItem onClick={() => setSharePageId(activePageId)}>
								<Share2Icon />
								Share
							</DropdownMenuItem>
							<DropdownMenuItem
								disabled={exporting !== null}
								onClick={() => void exportPage("markdown")}
							>
								<DownloadIcon />
								{exporting === "markdown" ? "Exporting…" : "Export Markdown"}
							</DropdownMenuItem>
							<DropdownMenuItem
								disabled={exporting !== null}
								onClick={() => void exportPage("html")}
							>
								<FileCode2Icon />
								{exporting === "html" ? "Exporting…" : "Export HTML"}
							</DropdownMenuItem>
							<DropdownMenuItem
								variant="destructive"
								onClick={() => {
									setTrashError(null);
									setTrashTarget({
										pageId: activePageId,
										workspaceId: activeWorkspaceId,
										title: pageQuery.data?.title || "Untitled",
									});
								}}
							>
								<Trash2Icon />
								Move to trash
							</DropdownMenuItem>
						</DropdownMenuGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			)}

			{canEdit && sharePageId ? (
				<ResponsiveDialog
					open
					onOpenChange={(open) => {
						if (!open) setSharePageId(null);
					}}
					title="Share"
					description="Publish a read-only link to this page."
					className="sm:max-w-sm"
				>
					<SharePanel pageId={sharePageId} active />
				</ResponsiveDialog>
			) : null}

			{canEdit ? (
				<DestructiveConfirmationDialog
					open={trashTarget !== null}
					onOpenChange={(open) => {
						if (trashPending) return;
						if (!open) {
							setTrashTarget(null);
							setTrashError(null);
						}
					}}
					title="Move to trash?"
					description={`Move ${trashTarget?.title ?? "Untitled"} and any subpages to trash? You can restore them later from Trash.`}
					actionLabel="Move to trash"
					pendingLabel="Moving…"
					pending={trashPending}
					error={trashError}
					onConfirm={() => void moveToTrash()}
				/>
			) : null}
		</>
	);
}
