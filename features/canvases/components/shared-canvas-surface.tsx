"use client";

import "tldraw/tldraw.css";

import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { type Editor, Tldraw } from "tldraw";
import { TLDRAW_LICENSE_KEY } from "@/features/canvases/lib/tldraw-license";
import { rq } from "@/client";
import { loadableSnapshot } from "@/features/canvases/lib/snapshot";
import { getSharedCanvas } from "@/features/shares/contracts";

/**
 * Read-only canvas for the public share view: fetches the snapshot through
 * the share-scoped endpoint (no session) and locks tldraw.
 */
export default function SharedCanvasSurface({
	token,
	canvasId,
}: {
	token: string;
	canvasId: string;
}) {
	const { resolvedTheme } = useTheme();
	const canvasQuery = useQuery(
		rq(getSharedCanvas).queryOptions({ path: { token, id: canvasId } }),
	);

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
	const snapshot = loadableSnapshot(stored);

	function handleMount(editor: Editor) {
		editor.user.updateUserPreferences({
			colorScheme: resolvedTheme === "dark" ? "dark" : "light",
		});
		editor.updateInstanceState({ isReadonly: true });
	}

	return (
		<div className="relative h-full w-full">
			<Tldraw
				licenseKey={TLDRAW_LICENSE_KEY}
				snapshot={snapshot}
				onMount={handleMount}
			/>
		</div>
	);
}
