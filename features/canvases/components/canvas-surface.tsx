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
} from "tldraw";
import { TLDRAW_LICENSE_KEY } from "@/features/canvases/lib/tldraw-license";
import {
	getCanvasQueryOptions,
	saveCanvasSnapshotMutationOptions,
	setCanvasSnapshotInCache,
} from "@/features/canvases/client/queries";
import { authClient } from "@/client/auth-client";
import SharedCanvasSurface from "@/features/canvases/components/shared-canvas-surface";
import {
	type CanvasCollabUser,
	useCollabCanvasStore,
} from "@/features/canvases/components/use-collab-canvas-store";
import {
	isLoadableSnapshot,
	loadableSnapshot,
} from "@/features/canvases/lib/snapshot";
import {
	type CollabRoom,
	useCollabSession,
} from "@/features/collab/client/session";
import { canvasRoomId, cursorColorFor } from "@/features/collab/lib/room";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
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
	const collabSession = useCollabSession(canvasRoomId(canvasId));
	const canEdit = useCanEditWorkspace();

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

	if (canvasQuery.isPending || collabSession.status === "connecting") {
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

	if (collabSession.status === "ready") {
		return (
			<CollabCanvasSurface
				canvasId={canvasId}
				room={collabSession.room}
				snapshot={canvasQuery.data.snapshot}
				canEdit={canEdit}
			/>
		);
	}

	const stored = canvasQuery.data.snapshot;
	// Legacy/empty rows without a schema crash tldraw's migrator; treat them
	// as a fresh canvas instead.
	const snapshot = loadableSnapshot(stored);

	function handleMount(editor: Editor) {
		editor.user.updateUserPreferences({
			colorScheme: resolvedTheme === "dark" ? "dark" : "light",
		});
		if (!canEdit) {
			editor.updateInstanceState({ isReadonly: true });
		}

		let dirty = false;

		// Another member (or tab) saved since we loaded: adopt the server's
		// snapshot rather than clobbering it, and rebase future saves on it.
		async function reloadFromServer() {
			const fresh = await queryClient.fetchQuery({
				...getCanvasQueryOptions(canvasId),
				staleTime: 0,
			});
			baseUpdatedAtRef.current = fresh.updatedAt;
			if (isLoadableSnapshot(fresh.snapshot)) {
				loadSnapshot(editor.store, {
					document: fresh.snapshot,
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
			<Tldraw
				licenseKey={TLDRAW_LICENSE_KEY}
				snapshot={snapshot}
				onMount={handleMount}
			/>
			{saveState === "saving" ? (
				<span className="pointer-events-none absolute right-2 bottom-2 z-10 rounded bg-background/80 px-1.5 py-0.5 text-muted-foreground text-xs">
					Saving…
				</span>
			) : null}
		</div>
	);
}

/**
 * The collaborative canvas: the tldraw store is bound to the room's shared
 * Y.Map, so shapes sync live between members. Persistence works like the
 * page editor's — every editing peer debounce-saves the materialized
 * snapshot, without a CAS precondition (Yjs already merges).
 */
function CollabCanvasSurface({
	canvasId,
	room,
	snapshot,
	canEdit,
}: {
	canvasId: string;
	room: CollabRoom;
	snapshot: Record<string, unknown>;
	canEdit: boolean;
}) {
	const { resolvedTheme } = useTheme();
	const queryClient = useQueryClient();
	const saveMutation = useMutation(saveCanvasSnapshotMutationOptions());
	// Cursor identity shown to the other people on this canvas.
	const session = authClient.useSession();
	const collabUser: CanvasCollabUser | undefined = session.data
		? {
				id: session.data.user.id,
				name: session.data.user.name || session.data.user.email || "Member",
				color: cursorColorFor(session.data.user.id),
			}
		: undefined;
	const storeWithStatus = useCollabCanvasStore(room, snapshot, collabUser);

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

	function handleMount(editor: Editor) {
		editor.user.updateUserPreferences({
			colorScheme: resolvedTheme === "dark" ? "dark" : "light",
		});
		if (!canEdit) {
			editor.updateInstanceState({ isReadonly: true });
		}

		let dirty = false;

		function save() {
			if (!dirty || !canEdit) return;
			dirty = false;
			setSaveState("saving");
			const document = getSnapshot(editor.store).document as unknown as Record<
				string,
				unknown
			>;
			setCanvasSnapshotInCache(queryClient, canvasId, document);
			saveMutation.mutate(
				{ path: { id: canvasId }, body: { snapshot: document } },
				{
					onError: () => {
						// Transient failure: keep local changes and retry on the next
						// edit/flush; the shared doc is the live source of truth anyway.
						dirty = true;
					},
					onSettled: () => setSaveState("saved"),
				},
			);
		}
		flushRef.current = save;

		// Only this user's own edits schedule a save; remote peers persist
		// their own edits (converged content makes the writes equivalent).
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
			<Tldraw
				licenseKey={TLDRAW_LICENSE_KEY}
				store={storeWithStatus}
				onMount={handleMount}
			/>
			{saveState === "saving" ? (
				<span className="pointer-events-none absolute right-2 bottom-2 z-10 rounded bg-background/80 px-1.5 py-0.5 text-muted-foreground text-xs">
					Saving…
				</span>
			) : null}
		</div>
	);
}
