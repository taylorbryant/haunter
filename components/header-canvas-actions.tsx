"use client";

import { contractErrorMessage } from "@beignet/core/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontalIcon, PencilIcon, StarIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import {
	ResponsiveDialog,
	ResponsiveDialogFooter,
} from "@/components/responsive-dialog";
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
import { Input } from "@/components/ui/input";
import {
	getCanvasNavigationQueryOptions,
	getCanvasQueryOptions,
	invalidateCanvasList,
	invalidateCanvasNavigation,
	setCanvasTitleInCache,
	updateCanvasMutationOptions,
} from "@/features/canvases/client/queries";
import {
	type CanvasSaveState,
	useCanvasSaveState,
} from "@/features/canvases/client/save-state";
import { useCanvasFavorite } from "@/features/canvases/client/use-canvas-favorite";
import { CANVAS_TITLE_MAX_LENGTH } from "@/features/canvases/schemas";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import { useWorkspaceRouteSync } from "@/features/workspaces/client/use-workspace-route-sync";
import { useIsMobile } from "@/hooks/use-mobile";

function saveLabel(state: CanvasSaveState) {
	if (state === "saving") return "Saving…";
	if (state === "local") return "Saved locally";
	if (state === "error") return "Save failed";
	return "Saved";
}

export function HeaderCanvasActions() {
	const pathname = usePathname();
	const queryClient = useQueryClient();
	const workspaceId = pathname.match(/^\/w\/([^/]+)/)?.[1] ?? null;
	const canvasId = pathname.match(/\/c\/([^/]+)/)?.[1] ?? null;
	const { synced } = useWorkspaceRouteSync(workspaceId);
	const canEdit = useCanEditWorkspace();
	const isMobile = useIsMobile();
	const saveState = useCanvasSaveState(canvasId);
	const canvasQuery = useQuery({
		...getCanvasQueryOptions(canvasId ?? ""),
		enabled: canvasId !== null && synced,
	});
	const navigationQuery = useQuery({
		...getCanvasNavigationQueryOptions(workspaceId ?? ""),
		enabled: workspaceId !== null && canvasId !== null && synced,
	});
	const favorite = useCanvasFavorite(workspaceId ?? "", canvasQuery.data);
	const updateMutation = useMutation({
		...updateCanvasMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const [renameOpen, setRenameOpen] = useState(false);
	const [renameValue, setRenameValue] = useState("");
	const [renameError, setRenameError] = useState<string | null>(null);
	const isFavorite = navigationQuery.data?.favorites.some(
		(item) => item.id === canvasId,
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: close canvas-scoped dialogs whenever the route identity changes
	useEffect(() => {
		setRenameOpen(false);
		setRenameError(null);
	}, [canvasId, workspaceId]);

	if (!canvasId || !workspaceId || !synced) return null;
	const activeCanvasId = canvasId;

	function startRename() {
		setRenameValue(canvasQuery.data?.title ?? "");
		setRenameError(null);
		setRenameOpen(true);
	}

	async function renameCanvas(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const normalizedTitle = renameValue.trim();
		if (!canEdit || !normalizedTitle || updateMutation.isPending) return;
		if (normalizedTitle === canvasQuery.data?.title) {
			setRenameOpen(false);
			return;
		}

		setRenameError(null);
		try {
			const canvas = await updateMutation.mutateAsync({
				path: { id: activeCanvasId },
				body: { title: normalizedTitle },
			});
			setCanvasTitleInCache(
				queryClient,
				activeCanvasId,
				canvas.title ?? normalizedTitle,
				canvas.updatedAt,
			);
			await Promise.all([
				invalidateCanvasList(queryClient),
				invalidateCanvasNavigation(queryClient, canvas.workspaceId),
			]);
			setRenameOpen(false);
		} catch (error) {
			setRenameError(
				contractErrorMessage(error, "The canvas title could not be saved."),
			);
		}
	}

	return (
		<>
			<p
				className="shrink-0 whitespace-nowrap text-muted-foreground text-xs"
				aria-live="polite"
			>
				{saveLabel(saveState)}
			</p>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="shrink-0 text-muted-foreground"
				aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
				title={isFavorite ? "Remove from favorites" : "Add to favorites"}
				disabled={
					!canvasQuery.data || !navigationQuery.data || favorite.isPending
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
								type="button"
								variant="ghost"
								size="icon-sm"
								className="shrink-0 text-muted-foreground"
								aria-label="Canvas actions"
							/>
						}
					>
						<MoreHorizontalIcon />
					</DrawerTrigger>
					<DrawerContent>
						<DrawerHeader>
							<DrawerTitle>Actions</DrawerTitle>
							<DrawerDescription className="sr-only">
								Canvas actions
							</DrawerDescription>
						</DrawerHeader>
						<div className="flex flex-col p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
							<DrawerClose
								render={
									<Button
										type="button"
										variant="ghost"
										className="h-11 justify-start"
										onClick={startRename}
									/>
								}
							>
								<PencilIcon />
								Rename
							</DrawerClose>
						</div>
					</DrawerContent>
				</Drawer>
			) : (
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								className="shrink-0 text-muted-foreground"
								aria-label="Canvas actions"
							/>
						}
					>
						<MoreHorizontalIcon />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-48">
						<DropdownMenuItem onClick={startRename}>
							<PencilIcon />
							Rename
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			)}

			<ResponsiveDialog
				open={renameOpen}
				onOpenChange={(open) => {
					if (updateMutation.isPending) return;
					setRenameOpen(open);
					if (!open) setRenameError(null);
				}}
				title="Rename canvas"
				description="Choose a new name for this canvas."
				className="sm:max-w-sm"
			>
				<form className="flex flex-col gap-4" onSubmit={renameCanvas}>
					<Input
						autoFocus
						name="title"
						value={renameValue}
						aria-label="Canvas title"
						aria-invalid={renameError ? true : undefined}
						maxLength={CANVAS_TITLE_MAX_LENGTH}
						onChange={(event) => {
							setRenameValue(event.target.value);
							setRenameError(null);
						}}
					/>
					{renameError ? (
						<p role="alert" className="text-destructive text-sm">
							{renameError}
						</p>
					) : null}
					<ResponsiveDialogFooter>
						<Button
							type="submit"
							disabled={!renameValue.trim() || updateMutation.isPending}
						>
							{updateMutation.isPending ? "Renaming…" : "Rename"}
						</Button>
					</ResponsiveDialogFooter>
				</form>
			</ResponsiveDialog>
		</>
	);
}
