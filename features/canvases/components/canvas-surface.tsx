"use client";

import "tldraw/tldraw.css";

import { ContractError } from "@beignet/core/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import {
	type Editor,
	getSnapshot,
	loadSnapshot,
	Tldraw,
	type TLStoreSnapshot,
} from "tldraw";
import {
	getCanvasQueryOptions,
	saveCanvasSnapshotMutationOptions,
	setCanvasSnapshotInCache,
} from "@/features/canvases/client/queries";
import SharedCanvasSurface from "@/features/canvases/components/shared-canvas-surface";
import { useSharedPageToken } from "@/features/shares/components/shared-page-context";

const SNAPSHOT_SAVE_DELAY_MS = 1500;

export default function CanvasSurface({ canvasId }: { canvasId: string }) {
	// Inside a public share view, swap to the read-only token-scoped surface.
	const shareToken = useSharedPageToken();
	if (shareToken) {
		return <SharedCanvasSurface token={shareToken} canvasId={canvasId} />;
	}

	return <MemberCanvasSurface canvasId={canvasId} />;
}

function MemberCanvasSurface({ canvasId }: { canvasId: string }) {
	const { resolvedTheme } = useTheme();
	const queryClient = useQueryClient();
	const canvasQuery = useQuery(getCanvasQueryOptions(canvasId));
	const saveMutation = useMutation(saveCanvasSnapshotMutationOptions());

	const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const flushRef = useRef<() => void>(() => {});
	// Last server updatedAt this client saw: the optimistic-concurrency base.
	const baseUpdatedAtRef = useRef<string | null>(null);
	if (canvasQuery.data && baseUpdatedAtRef.current === null) {
		baseUpdatedAtRef.current = canvasQuery.data.updatedAt;
	}

	// Flush a pending snapshot save when the block unmounts.
	useEffect(() => {
		return () => {
			if (timeoutRef.current) clearTimeout(timeoutRef.current);
			flushRef.current();
		};
	}, []);

	if (canvasQuery.isPending) {
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground text-sm">
				Loading canvas…
			</div>
		);
	}

	if (canvasQuery.isError || !canvasQuery.data) {
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground text-sm">
				This canvas could not be loaded.
			</div>
		);
	}

	const stored = canvasQuery.data.snapshot;
	const snapshot =
		Object.keys(stored).length > 0
			? (stored as unknown as TLStoreSnapshot)
			: undefined;

	function handleMount(editor: Editor) {
		editor.user.updateUserPreferences({
			colorScheme: resolvedTheme === "dark" ? "dark" : "light",
		});

		let dirty = false;

		// Another member (or tab) saved since we loaded: adopt the server's
		// snapshot rather than clobbering it, and rebase future saves on it.
		async function reloadFromServer() {
			const fresh = await queryClient.fetchQuery({
				...getCanvasQueryOptions(canvasId),
				staleTime: 0,
			});
			baseUpdatedAtRef.current = fresh.updatedAt;
			if (Object.keys(fresh.snapshot).length > 0) {
				loadSnapshot(editor.store, {
					document: fresh.snapshot as unknown as TLStoreSnapshot,
				});
			}
			dirty = false;
		}

		function save() {
			if (!dirty) return;
			dirty = false;
			setSaveState("saving");
			const snapshot = getSnapshot(editor.store).document as unknown as Record<
				string,
				unknown
			>;
			// Mirror into the cache immediately so a remount (e.g. switching to
			// the expanded dialog) never restores a stale drawing.
			setCanvasSnapshotInCache(queryClient, canvasId, snapshot);
			saveMutation.mutate(
				{
					path: { id: canvasId },
					body: {
						snapshot,
						...(baseUpdatedAtRef.current
							? { baseUpdatedAt: baseUpdatedAtRef.current }
							: {}),
					},
				},
				{
					onSuccess: (result) => {
						baseUpdatedAtRef.current = result.updatedAt;
					},
					onError: (error) => {
						if (error instanceof ContractError && error.status === 409) {
							void reloadFromServer();
						} else {
							// Transient failure: keep the local changes and retry on the
							// next edit/flush.
							dirty = true;
						}
					},
					onSettled: () => setSaveState("saved"),
				},
			);
		}

		flushRef.current = save;

		const unlisten = editor.store.listen(
			() => {
				dirty = true;
				if (timeoutRef.current) clearTimeout(timeoutRef.current);
				timeoutRef.current = setTimeout(save, SNAPSHOT_SAVE_DELAY_MS);
			},
			{ scope: "document", source: "user" },
		);

		return () => {
			unlisten();
			save();
		};
	}

	return (
		<div className="relative h-full w-full">
			<Tldraw snapshot={snapshot} onMount={handleMount} />
			{saveState === "saving" ? (
				<span className="pointer-events-none absolute right-2 bottom-2 z-10 rounded bg-background/80 px-1.5 py-0.5 text-muted-foreground text-xs">
					Saving…
				</span>
			) : null}
		</div>
	);
}
