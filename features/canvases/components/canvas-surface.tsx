"use client";

import "tldraw/tldraw.css";

import { ContractError } from "@beignet/core/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import {
	createTLStore,
	defaultBindingUtils,
	defaultShapeUtils,
	type Editor,
	getSnapshot,
	loadSnapshot,
	Tldraw,
} from "tldraw";
import { useCurrentUser } from "@/components/app-session-provider";
import { userErrorMessage } from "@/client/error-feedback";
import { Button } from "@/components/ui/button";
import {
	getCanvasQueryOptions,
	saveCanvasSnapshotMutationOptions,
	setCanvasSnapshotInCache,
} from "@/features/canvases/client/queries";
import SharedCanvasSurface from "@/features/canvases/components/shared-canvas-surface";
import { useCanvasTheme } from "@/features/canvases/components/use-canvas-theme";
import {
	type CanvasCollabUser,
	useCollabCanvasStore,
} from "@/features/canvases/components/use-collab-canvas-store";
import {
	isLoadableSnapshot,
	loadableSnapshot,
} from "@/features/canvases/lib/snapshot";
import { TLDRAW_LICENSE_KEY } from "@/features/canvases/lib/tldraw-license";
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
	const syncCanvasTheme = useCanvasTheme(resolvedTheme);
	const queryClient = useQueryClient();
	const canvasQuery = useQuery(getCanvasQueryOptions(canvasId));
	const saveMutation = useMutation({
		...saveCanvasSnapshotMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const collabSession = useCollabSession(canvasRoomId(canvasId));
	const canEdit = useCanEditWorkspace();

	const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
		"saved",
	);
	const [saveError, setSaveError] = useState<string | null>(null);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const flushRef = useRef<() => void>(() => {});
	// Last server updatedAt this client saw: the optimistic-concurrency base.
	const baseUpdatedAtRef = useRef<string | null>(null);
	const localStoreRef = useRef<{
		canvasId: string;
		store: ReturnType<typeof createTLStore>;
	} | null>(null);
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

	if (!canvasQuery.data) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground text-sm">
				<p>This canvas could not be loaded.</p>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => void canvasQuery.refetch()}
				>
					Try again
				</Button>
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
	// Seed tldraw once. Saving mirrors snapshots into React Query, and feeding
	// that changing object back through the `snapshot` prop makes tldraw rebuild.
	if (!localStoreRef.current || localStoreRef.current.canvasId !== canvasId) {
		localStoreRef.current = {
			canvasId,
			store: createTLStore({
				shapeUtils: defaultShapeUtils,
				bindingUtils: defaultBindingUtils,
				snapshot,
			}),
		};
	}
	const localStore = localStoreRef.current.store;

	function handleMount(editor: Editor) {
		syncCanvasTheme(editor);
		if (!canEdit) {
			editor.updateInstanceState({ isReadonly: true });
		}

		let dirty = false;
		let saveInFlight = false;

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
			if (saveInFlight || !dirty) return;
			dirty = false;
			saveInFlight = true;
			setSaveError(null);
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
						saveInFlight = false;
						baseUpdatedAtRef.current = result.updatedAt;
						setSaveError(null);
						if (dirty) save();
						else setSaveState("saved");
					},
					onError: (error) => {
						saveInFlight = false;
						if (error instanceof ContractError && error.status === 409) {
							void reloadFromServer().then(
								() => {
									setSaveError(null);
									setSaveState("saved");
								},
								(reloadError) => {
									dirty = true;
									setSaveError(
										userErrorMessage(
											reloadError,
											"The latest canvas could not be loaded.",
										),
									);
									setSaveState("error");
								},
							);
						} else {
							// Transient failure: keep the local changes and retry on the
							// next edit/flush.
							dirty = true;
							setSaveError(
								userErrorMessage(error, "Canvas changes could not be saved."),
							);
							setSaveState("error");
						}
					},
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
				store={localStore}
				onMount={handleMount}
			/>
			{saveState === "saving" ? (
				<span className="pointer-events-none absolute right-2 bottom-2 z-10 rounded bg-background/80 px-1.5 py-0.5 text-muted-foreground text-xs">
					Saving…
				</span>
			) : null}
			{saveState === "error" && saveError ? (
				<div
					role="alert"
					className="absolute right-2 bottom-2 z-10 flex max-w-xs items-center gap-2 rounded border border-destructive/30 bg-background/95 px-2 py-1.5 text-destructive text-xs shadow"
				>
					<span className="flex-1">{saveError}</span>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={saveMutation.isPending}
						onClick={() => flushRef.current()}
					>
						Retry
					</Button>
				</div>
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
	const syncCanvasTheme = useCanvasTheme(resolvedTheme);
	const queryClient = useQueryClient();
	const saveMutation = useMutation({
		...saveCanvasSnapshotMutationOptions(),
		meta: { errorMode: "inline" },
	});
	// Cursor identity shown to the other people on this canvas.
	const currentUser = useCurrentUser();
	const collabUser: CanvasCollabUser | undefined = currentUser
		? {
				id: currentUser.id,
				name: currentUser.name || currentUser.email || "Member",
				color: cursorColorFor(currentUser.id),
			}
		: undefined;
	const storeWithStatus = useCollabCanvasStore(room, snapshot, collabUser);

	const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
		"saved",
	);
	const [saveError, setSaveError] = useState<string | null>(null);
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
		syncCanvasTheme(editor);
		if (!canEdit) {
			editor.updateInstanceState({ isReadonly: true });
		}

		let dirty = false;
		let saveInFlight = false;

		function save() {
			if (saveInFlight || !dirty || !canEdit) return;
			dirty = false;
			saveInFlight = true;
			setSaveError(null);
			setSaveState("saving");
			const document = getSnapshot(editor.store).document as unknown as Record<
				string,
				unknown
			>;
			setCanvasSnapshotInCache(queryClient, canvasId, document);
			saveMutation.mutate(
				{ path: { id: canvasId }, body: { snapshot: document } },
				{
					onSuccess: () => {
						saveInFlight = false;
						setSaveError(null);
						if (dirty) save();
						else setSaveState("saved");
					},
					onError: (error) => {
						saveInFlight = false;
						// Transient failure: keep local changes and retry on the next
						// edit/flush; the shared doc is the live source of truth anyway.
						dirty = true;
						setSaveError(
							userErrorMessage(error, "Canvas changes could not be saved."),
						);
						setSaveState("error");
					},
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
			{saveState === "error" && saveError ? (
				<div
					role="alert"
					className="absolute right-2 bottom-2 z-10 flex max-w-xs items-center gap-2 rounded border border-destructive/30 bg-background/95 px-2 py-1.5 text-destructive text-xs shadow"
				>
					<span className="flex-1">{saveError}</span>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={saveMutation.isPending}
						onClick={() => flushRef.current()}
					>
						Retry
					</Button>
				</div>
			) : null}
		</div>
	);
}
