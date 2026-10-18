"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef } from "react";
import {
	getCanvasQueryOptions,
	recordCanvasViewMutationOptions,
	syncRecordedCanvasViewInNavigationCache,
} from "@/features/canvases/client/queries";
import {
	type CanvasSaveState,
	setCanvasSaveState,
} from "@/features/canvases/client/save-state";

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

export function StandaloneCanvas({ canvasId }: { canvasId: string }) {
	const queryClient = useQueryClient();
	const canvasQuery = useQuery(getCanvasQueryOptions(canvasId));
	const recordViewMutation = useMutation({
		...recordCanvasViewMutationOptions(),
		meta: { errorMode: "silent" },
	});
	const recordedViewCanvasIdRef = useRef<string | null>(null);
	const handleSaveStateChange = useCallback(
		(state: CanvasSaveState) => setCanvasSaveState(canvasId, state),
		[canvasId],
	);

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
		<div className="h-[calc(100svh-3rem)] min-h-96 border-t border-border">
			<CanvasSurface
				canvasId={canvasId}
				layoutKey="standalone"
				onSaveStateChange={handleSaveStateChange}
			/>
		</div>
	);
}
