"use client";

import { contractErrorMessage } from "@beignet/core/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, ShapesIcon, StarIcon, Trash2Icon } from "lucide-react";
import { WorkspaceLink as Link } from "@/client/workspace-navigation";
import { useState } from "react";
import { useCreateDialog } from "@/components/create-dialog-provider";
import { DestructiveConfirmationDialog } from "@/components/destructive-confirmation-dialog";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/query-error";
import {
	WorkspaceScreen,
	WorkspaceScreenHeader,
} from "@/components/workspace-screen";
import {
	deleteCanvasMutationOptions,
	getCanvasNavigationQueryOptions,
	invalidateCanvases,
	listCanvasesQueryOptions,
} from "@/features/canvases/client/queries";
import { useCanvasFavorite } from "@/features/canvases/client/use-canvas-favorite";
import type { CanvasListItem } from "@/features/canvases/schemas";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";

function updatedLabel(value: string) {
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
	}).format(new Date(value));
}

function CanvasListRow({
	canvas,
	workspaceId,
	canEdit,
	isFavorite,
	navigationLoaded,
	onDelete,
}: {
	canvas: CanvasListItem;
	workspaceId: string;
	canEdit: boolean;
	isFavorite: boolean;
	navigationLoaded: boolean;
	onDelete: () => void;
}) {
	const favorite = useCanvasFavorite(workspaceId, canvas);

	return (
		<li className="@container py-3">
			<div className="flex min-w-0 flex-col gap-1 @md:flex-row @md:items-center @md:gap-2">
				<Link
					href={`/w/${workspaceId}/c/${canvas.id}`}
					className="keyboard-focus-ring -ml-2 flex min-w-0 flex-1 items-start gap-3 rounded-md p-2 hover:bg-accent hover:text-accent-foreground [--keyboard-focus-ring-size:2px]"
				>
					<ShapesIcon
						aria-hidden="true"
						className="mt-1 size-4 shrink-0 text-muted-foreground"
					/>
					<div className="min-w-0 flex-1">
						<p className="font-medium text-base leading-6 [overflow-wrap:anywhere] sm:text-sm">
							{canvas.title || "Untitled"}
						</p>
						<p className="text-base text-muted-foreground sm:text-sm">
							Updated{" "}
							<time dateTime={canvas.updatedAt} suppressHydrationWarning>
								{updatedLabel(canvas.updatedAt)}
							</time>
						</p>
					</div>
				</Link>
				<div className="flex items-center gap-2 pl-5 @md:shrink-0 @md:pl-0">
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className="shrink-0 text-muted-foreground"
						aria-label={
							isFavorite
								? `Remove ${canvas.title || "Untitled"} from favorites`
								: `Add ${canvas.title || "Untitled"} to favorites`
						}
						title={isFavorite ? "Remove from favorites" : "Add to favorites"}
						aria-pressed={isFavorite}
						disabled={!navigationLoaded || favorite.isPending}
						onClick={() => favorite.toggle(!isFavorite)}
					>
						<StarIcon className={isFavorite ? "fill-current" : undefined} />
					</Button>
					{canEdit ? (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className="shrink-0 text-muted-foreground hover:text-destructive"
							aria-label={`Delete ${canvas.title || "Untitled"}`}
							onClick={onDelete}
						>
							<Trash2Icon />
						</Button>
					) : null}
				</div>
			</div>
		</li>
	);
}

export function CanvasList({
	workspaceId,
	allowDelete = true,
	allowFavorites = true,
}: {
	workspaceId: string;
	allowDelete?: boolean;
	allowFavorites?: boolean;
}) {
	const queryClient = useQueryClient();
	const canEdit = useCanEditWorkspace();
	const { openCreateCanvas } = useCreateDialog();
	const canvasesQuery = useQuery(listCanvasesQueryOptions(workspaceId));
	const navigationQuery = useQuery(
		getCanvasNavigationQueryOptions(workspaceId),
	);
	const deleteMutation = useMutation({
		...deleteCanvasMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const [deleteTarget, setDeleteTarget] = useState<CanvasListItem | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	async function deleteCanvas() {
		if (!deleteTarget || deleteMutation.isPending) return;
		setDeleteError(null);
		try {
			await deleteMutation.mutateAsync({ path: { id: deleteTarget.id } });
			setDeleteTarget(null);
			await invalidateCanvases(queryClient);
		} catch (error) {
			setDeleteError(
				contractErrorMessage(
					error,
					"The canvas could not be deleted. Try again.",
				),
			);
		}
	}

	const items = canvasesQuery.data?.items ?? [];

	return (
		<WorkspaceScreen>
			<WorkspaceScreenHeader
				title="Canvases"
				description="Explore ideas, sketch concepts, and map how things connect."
				actions={
					canEdit ? (
						<Button type="button" onClick={openCreateCanvas}>
							<PlusIcon data-icon="inline-start" />
							New canvas
						</Button>
					) : null
				}
			/>
			{canvasesQuery.isPending ? (
				<p className="text-base text-muted-foreground sm:text-sm">
					Loading canvases…
				</p>
			) : canvasesQuery.isError && !canvasesQuery.data ? (
				<QueryError
					message="Canvases could not be loaded."
					retrying={canvasesQuery.isFetching}
					onRetry={() => void canvasesQuery.refetch()}
				/>
			) : items.length === 0 ? (
				<p className="text-base text-muted-foreground sm:text-sm">
					{canEdit
						? "No canvases yet. Create one to start sketching."
						: "No canvases yet."}
				</p>
			) : (
				<ul aria-label="Canvases" className="list-none divide-y divide-border">
					{items.map((canvas) => (
						<CanvasListRow
							key={canvas.id}
							canvas={canvas}
							workspaceId={workspaceId}
							canEdit={canEdit && allowDelete}
							isFavorite={
								navigationQuery.data?.favorites.some(
									(item) => item.id === canvas.id,
								) ?? false
							}
							navigationLoaded={allowFavorites && Boolean(navigationQuery.data)}
							onDelete={() => {
								setDeleteError(null);
								setDeleteTarget(canvas);
							}}
						/>
					))}
				</ul>
			)}

			<DestructiveConfirmationDialog
				open={deleteTarget !== null}
				onOpenChange={(open) => {
					if (deleteMutation.isPending) return;
					if (!open) {
						setDeleteTarget(null);
						setDeleteError(null);
					}
				}}
				title="Delete canvas?"
				description={`Permanently delete ${deleteTarget?.title || "Untitled"}? This cannot be undone.`}
				actionLabel="Delete canvas"
				pendingLabel="Deleting…"
				pending={deleteMutation.isPending}
				error={deleteError}
				onConfirm={() => void deleteCanvas()}
			/>
		</WorkspaceScreen>
	);
}
