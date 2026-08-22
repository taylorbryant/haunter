"use client";

import { contractErrorMessage } from "@beignet/core/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, ShapesIcon, StarIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useCreateDialog } from "@/components/create-dialog-provider";
import { DestructiveConfirmationDialog } from "@/components/destructive-confirmation-dialog";
import { Button } from "@/components/ui/button";
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
		<li className="flex min-w-0 items-center gap-2 p-2">
			<Link
				href={`/w/${workspaceId}/c/${canvas.id}`}
				className="flex min-w-0 flex-1 items-start gap-3 rounded-md p-2 hover:bg-accent"
			>
				<ShapesIcon className="size-4 shrink-0 text-muted-foreground" />
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-base sm:text-sm">
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
		</li>
	);
}

export function CanvasList({ workspaceId }: { workspaceId: string }) {
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
		<div className="flex flex-col gap-6">
			<div className="flex min-w-0 items-start justify-between gap-4">
				<div className="min-w-0">
					<h1 className="text-balance font-heading font-semibold text-xl">
						Canvases
					</h1>
					<p className="text-pretty text-base text-muted-foreground sm:text-sm">
						Explore ideas, sketch concepts, and map how things connect.
					</p>
				</div>
				{canEdit ? (
					<Button type="button" onClick={openCreateCanvas}>
						<PlusIcon data-icon="inline-start" />
						New canvas
					</Button>
				) : null}
			</div>

			{canvasesQuery.isPending ? (
				<p className="text-base text-muted-foreground sm:text-sm">
					Loading canvases…
				</p>
			) : canvasesQuery.isError ? (
				<div className="flex flex-col items-start gap-3 rounded-lg border border-border p-5">
					<p className="text-base text-muted-foreground sm:text-sm">
						Canvases could not be loaded.
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void canvasesQuery.refetch()}
					>
						Try again
					</Button>
				</div>
			) : items.length === 0 ? (
				<div className="flex flex-col items-start gap-3 rounded-lg border border-border p-6">
					<ShapesIcon className="size-4 shrink-0 text-muted-foreground" />
					<div className="flex flex-col gap-1">
						<h2 className="font-medium">No canvases yet</h2>
						<p className="text-pretty text-base text-muted-foreground sm:text-sm">
							Create your first canvas to start thinking visually.
						</p>
					</div>
					{canEdit ? (
						<Button type="button" variant="outline" onClick={openCreateCanvas}>
							<PlusIcon data-icon="inline-start" />
							Create canvas
						</Button>
					) : null}
				</div>
			) : (
				<ul className="list-none divide-y divide-border rounded-lg border border-border">
					{items.map((canvas) => (
						<CanvasListRow
							key={canvas.id}
							canvas={canvas}
							workspaceId={workspaceId}
							canEdit={canEdit}
							isFavorite={
								navigationQuery.data?.favorites.some(
									(item) => item.id === canvas.id,
								) ?? false
							}
							navigationLoaded={Boolean(navigationQuery.data)}
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
		</div>
	);
}
