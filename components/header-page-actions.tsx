"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontalIcon, Share2Icon, Trash2Icon } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { userErrorMessage } from "@/client/error-feedback";
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
	deletePageMutationOptions,
	getPageQueryOptions,
	invalidatePages,
	invalidateTrash,
} from "@/features/pages/client/queries";
import { flushPendingPageSave } from "@/features/pages/client/save-state";
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
	const workspaceId = pathname.match(/^\/w\/([^/]+)/)?.[1] ?? null;
	const pageId = pathname.match(/\/p\/([^/]+)/)?.[1] ?? null;
	const { synced } = useWorkspaceRouteSync(workspaceId);
	const canEdit = useCanEditWorkspace();
	const isMobile = useIsMobile();
	const pageQuery = useQuery({
		...getPageQueryOptions(pageId ?? ""),
		enabled: Boolean(pageId && synced),
	});
	const deleteMutation = useMutation({
		...deletePageMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const [shareOpen, setShareOpen] = useState(false);
	const [trashOpen, setTrashOpen] = useState(false);
	const [preparingTrash, setPreparingTrash] = useState(false);
	const [trashError, setTrashError] = useState<string | null>(null);

	if (!pageId || !workspaceId || !canEdit || !synced) return null;

	const activePageId = pageId;
	const activeWorkspaceId = workspaceId;
	const trashPending = preparingTrash || deleteMutation.isPending;

	async function moveToTrash() {
		if (trashPending) return;
		setTrashError(null);
		setPreparingTrash(true);
		try {
			if (!(await flushPendingPageSave(activePageId))) {
				setTrashError("Save this page before moving it to trash.");
				return;
			}
			await deleteMutation.mutateAsync({ path: { id: activePageId } });
			setTrashOpen(false);
			await Promise.all([
				invalidatePages(queryClient),
				invalidateTrash(queryClient),
				invalidateTasks(queryClient),
			]);
			router.push(`/w/${activeWorkspaceId}`);
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
			{isMobile ? (
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
										onClick={() => setShareOpen(true)}
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
										className="h-11 justify-start text-destructive hover:text-destructive"
										onClick={() => {
											setTrashError(null);
											setTrashOpen(true);
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
							<DropdownMenuItem onClick={() => setShareOpen(true)}>
								<Share2Icon />
								Share
							</DropdownMenuItem>
							<DropdownMenuItem
								variant="destructive"
								onClick={() => {
									setTrashError(null);
									setTrashOpen(true);
								}}
							>
								<Trash2Icon />
								Move to trash
							</DropdownMenuItem>
						</DropdownMenuGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			)}

			{shareOpen ? (
				<ResponsiveDialog
					open
					onOpenChange={setShareOpen}
					title="Share"
					description="Publish a read-only link to this page."
					className="sm:max-w-sm"
				>
					<SharePanel pageId={activePageId} active />
				</ResponsiveDialog>
			) : null}

			<DestructiveConfirmationDialog
				open={trashOpen}
				onOpenChange={(open) => {
					if (trashPending) return;
					setTrashOpen(open);
					if (!open) setTrashError(null);
				}}
				title="Move to trash?"
				description={`Move ${pageQuery.data?.title || "Untitled"} and any subpages to trash? You can restore them later from Trash.`}
				actionLabel="Move to trash"
				pendingLabel="Moving…"
				pending={trashPending}
				error={trashError}
				onConfirm={() => void moveToTrash()}
			/>
		</>
	);
}
