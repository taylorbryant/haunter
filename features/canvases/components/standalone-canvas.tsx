"use client";

import { contractErrorMessage } from "@beignet/core/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StarIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	getCanvasNavigationQueryOptions,
	getCanvasQueryOptions,
	invalidateCanvasList,
	invalidateCanvasNavigation,
	recordCanvasViewMutationOptions,
	setCanvasTitleInCache,
	syncRecordedCanvasViewInNavigationCache,
	updateCanvasMutationOptions,
} from "@/features/canvases/client/queries";
import { useCanvasFavorite } from "@/features/canvases/client/use-canvas-favorite";
import type { CanvasSaveState } from "@/features/canvases/components/canvas-surface";
import { CANVAS_TITLE_MAX_LENGTH } from "@/features/canvases/schemas";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";

const CanvasSurface = dynamic(
	() => import("@/features/canvases/components/canvas-surface"),
	{
		ssr: false,
		loading: () => (
			<div className="flex h-full items-center justify-center text-base text-muted-foreground sm:text-sm">
				Loading canvas…
			</div>
		),
	},
);

function saveLabel(state: CanvasSaveState) {
	if (state === "saving") return "Saving…";
	if (state === "error") return "Save failed";
	return "Saved";
}

export function StandaloneCanvas({ canvasId }: { canvasId: string }) {
	const queryClient = useQueryClient();
	const canEdit = useCanEditWorkspace();
	const canvasQuery = useQuery(getCanvasQueryOptions(canvasId));
	const workspaceId = canvasQuery.data?.workspaceId ?? "";
	const navigationQuery = useQuery({
		...getCanvasNavigationQueryOptions(workspaceId),
		enabled: workspaceId.length > 0,
	});
	const favorite = useCanvasFavorite(workspaceId, canvasQuery.data);
	const recordViewMutation = useMutation({
		...recordCanvasViewMutationOptions(),
		meta: { errorMode: "silent" },
	});
	const updateMutation = useMutation({
		...updateCanvasMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const [title, setTitle] = useState("");
	const [titleError, setTitleError] = useState<string | null>(null);
	const [saveState, setSaveState] = useState<CanvasSaveState>("saved");
	const recordedViewCanvasIdRef = useRef<string | null>(null);
	const isFavorite = navigationQuery.data?.favorites.some(
		(canvas) => canvas.id === canvasId,
	);

	useEffect(() => {
		setTitle(canvasQuery.data?.title ?? "");
		setTitleError(null);
	}, [canvasQuery.data?.title]);

	useEffect(() => {
		const canvas = canvasQuery.data;
		if (!canvas || recordedViewCanvasIdRef.current === canvas.id) return;
		recordedViewCanvasIdRef.current = canvas.id;
		void recordViewMutation
			.mutateAsync({ path: { id: canvas.id }, body: {} })
			.then(({ lastViewedAt }) =>
				syncRecordedCanvasViewInNavigationCache(
					queryClient,
					canvas.workspaceId,
					canvas,
					lastViewedAt,
				),
			)
			.catch(() => {
				if (recordedViewCanvasIdRef.current === canvas.id) {
					recordedViewCanvasIdRef.current = null;
				}
			});
	}, [canvasQuery.data, queryClient, recordViewMutation.mutateAsync]);

	async function saveTitle(event?: FormEvent<HTMLFormElement>) {
		event?.preventDefault();
		const normalizedTitle = title.trim();
		if (
			!canEdit ||
			!normalizedTitle ||
			updateMutation.isPending ||
			normalizedTitle === canvasQuery.data?.title
		)
			return;

		setTitleError(null);
		try {
			const canvas = await updateMutation.mutateAsync({
				path: { id: canvasId },
				body: { title: normalizedTitle },
			});
			setTitle(canvas.title ?? normalizedTitle);
			setCanvasTitleInCache(queryClient, canvasId, normalizedTitle);
			void Promise.all([
				invalidateCanvasList(queryClient),
				invalidateCanvasNavigation(queryClient, canvas.workspaceId),
			]).catch(() => undefined);
		} catch (error) {
			setTitleError(
				contractErrorMessage(error, "The canvas title could not be saved."),
			);
		}
	}

	if (canvasQuery.isPending) {
		return (
			<div className="flex h-[calc(100svh-3rem)] items-center justify-center text-base text-muted-foreground sm:text-sm">
				Loading canvas…
			</div>
		);
	}

	if (!canvasQuery.data) {
		return (
			<div className="flex h-[calc(100svh-3rem)] items-center justify-center p-6 text-center text-base text-muted-foreground sm:text-sm">
				This canvas could not be loaded.
			</div>
		);
	}

	return (
		<div className="flex h-[calc(100svh-3rem)] min-h-96 flex-col">
			<div className="flex min-w-0 shrink-0 items-center gap-3 px-3 py-2 sm:px-4">
				<form className="min-w-0 flex-1" onSubmit={saveTitle}>
					<label htmlFor="standalone-canvas-title" className="sr-only">
						Canvas title
					</label>
					<Input
						id="standalone-canvas-title"
						name="title"
						value={title}
						readOnly={!canEdit}
						maxLength={CANVAS_TITLE_MAX_LENGTH}
						aria-invalid={Boolean(titleError)}
						aria-describedby={titleError ? "canvas-title-error" : undefined}
						className="h-8 max-w-md border-transparent bg-transparent px-2 font-medium shadow-none hover:border-input focus-visible:border-input"
						onBlur={() => void saveTitle()}
						onChange={(event) => {
							setTitle(event.target.value);
							if (titleError) setTitleError(null);
						}}
					/>
					{titleError ? (
						<p
							id="canvas-title-error"
							role="alert"
							className="text-destructive text-sm"
						>
							{titleError}
						</p>
					) : null}
				</form>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					className="shrink-0 text-muted-foreground"
					aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
					title={isFavorite ? "Remove from favorites" : "Add to favorites"}
					disabled={!navigationQuery.data || favorite.isPending}
					onClick={() => favorite.toggle(!isFavorite)}
				>
					<StarIcon className={isFavorite ? "fill-current" : undefined} />
				</Button>
				<p
					className="shrink-0 text-base text-muted-foreground sm:text-sm"
					aria-live="polite"
				>
					{saveLabel(saveState)}
				</p>
			</div>
			<div className="min-h-0 flex-1 border-t border-border">
				<CanvasSurface
					canvasId={canvasId}
					layoutKey="standalone"
					onSaveStateChange={setSaveState}
				/>
			</div>
		</div>
	);
}
