"use client";

import "tldraw/tldraw.css";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { type Editor, getSnapshot, Tldraw, type TLStoreSnapshot } from "tldraw";
import {
	getCanvasQueryOptions,
	saveCanvasSnapshotMutationOptions,
	setCanvasSnapshotInCache,
} from "@/features/canvases/client/queries";

const SNAPSHOT_SAVE_DELAY_MS = 1500;

export default function CanvasSurface({ canvasId }: { canvasId: string }) {
	const { resolvedTheme } = useTheme();
	const queryClient = useQueryClient();
	const canvasQuery = useQuery(getCanvasQueryOptions(canvasId));
	const saveMutation = useMutation(saveCanvasSnapshotMutationOptions());

	const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const flushRef = useRef<() => void>(() => {});

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
				{ path: { id: canvasId }, body: { snapshot } },
				{ onSettled: () => setSaveState("saved") },
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
