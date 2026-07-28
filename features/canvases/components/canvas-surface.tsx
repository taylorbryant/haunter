"use client";

import "tldraw/tldraw.css";

import { ContractError } from "@beignet/core/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useRef, useState } from "react";
import {
	createTLStore,
	defaultBindingUtils,
	type Editor,
	getSnapshot,
} from "tldraw";
import { userErrorMessage } from "@/client/error-feedback";
import { useCurrentUser } from "@/components/app-session-provider";
import { Button } from "@/components/ui/button";
import {
	getCanvasQueryOptions,
	refreshCanvasQuery,
	saveCanvasSnapshotMutationOptions,
	setCanvasSnapshotInCache,
} from "@/features/canvases/client/queries";
import {
	clearPendingCanvasSave,
	drainCanvasSaveQueue,
	getPendingCanvasSave,
	type PendingCanvasSave,
	registerCanvasSaveFlusher,
	rememberPendingCanvasSave,
} from "@/features/canvases/client/save-state";
import SharedCanvasSurface from "@/features/canvases/components/shared-canvas-surface";
import { TldrawWithFonts } from "@/features/canvases/components/tldraw-with-fonts";
import { useCanvasTheme } from "@/features/canvases/components/use-canvas-theme";
import {
	type CanvasCollabUser,
	useCollabCanvasStore,
} from "@/features/canvases/components/use-collab-canvas-store";
import { haunterShapeUtils } from "@/features/canvases/lib/shape-utils";
import { loadableSnapshot } from "@/features/canvases/lib/snapshot";
import { TLDRAW_LICENSE_KEY } from "@/features/canvases/lib/tldraw-license";
import {
	type CollabRoom,
	useCollabSession,
} from "@/features/collab/client/session";
import { canvasRoomId, cursorColorFor } from "@/features/collab/lib/room";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import { useSharedPageToken } from "@/features/shares/components/shared-page-context";

const SNAPSHOT_SAVE_DELAY_MS = 1500;
const CANVAS_CONFLICT_MESSAGE =
	"Canvas changed elsewhere. Your drawing is still here. Retry to keep this version.";

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
	const pendingSaveAtRender = getPendingCanvasSave(canvasId);

	const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
		pendingSaveAtRender ? "error" : "saved",
	);
	const [saveError, setSaveError] = useState<string | null>(
		pendingSaveAtRender ? CANVAS_CONFLICT_MESSAGE : null,
	);
	const flushRef = useRef<() => Promise<boolean>>(async () => true);
	const retryRef = useRef<() => Promise<boolean>>(async () => true);
	// Last server updatedAt this client saw: the optimistic-concurrency base.
	const baseVersionRef = useRef<{
		canvasId: string;
		updatedAt: string;
	} | null>(null);
	const localStoreRef = useRef<{
		canvasId: string;
		store: ReturnType<typeof createTLStore>;
	} | null>(null);
	if (canvasQuery.data && baseVersionRef.current?.canvasId !== canvasId) {
		baseVersionRef.current = {
			canvasId,
			updatedAt:
				pendingSaveAtRender?.baseUpdatedAt ?? canvasQuery.data.updatedAt,
		};
	}

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

	const initialUpdatedAt = canvasQuery.data.updatedAt;
	const stored = pendingSaveAtRender?.snapshot ?? canvasQuery.data.snapshot;
	// Legacy/empty rows without a schema crash tldraw's migrator; treat them
	// as a fresh canvas instead.
	const snapshot = loadableSnapshot(stored);
	// Seed tldraw once. Saving mirrors snapshots into React Query, and feeding
	// that changing object back through the `snapshot` prop makes tldraw rebuild.
	if (!localStoreRef.current || localStoreRef.current.canvasId !== canvasId) {
		localStoreRef.current = {
			canvasId,
			store: createTLStore({
				shapeUtils: haunterShapeUtils,
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

		let pendingSave: PendingCanvasSave | null = pendingSaveAtRender;
		let revision = pendingSave ? 1 : 0;
		let savedRevision = 0;
		let saveInFlight: Promise<boolean> | null = null;
		let conflictPending = pendingSave !== null;
		let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

		async function save(): Promise<boolean> {
			if (!canEdit) return true;
			if (conflictPending) return false;
			if (saveInFlight) {
				const saved = await saveInFlight;
				return saved && savedRevision < revision ? save() : saved;
			}
			if (savedRevision >= revision) return true;

			const savingRevision = revision;
			setSaveError(null);
			setSaveState("saving");
			const snapshot = getSnapshot(editor.store).document as unknown as Record<
				string,
				unknown
			>;
			const request = (async () => {
				try {
					// Cancel an older GET before staging the local value. Otherwise its
					// response can land later and make a remount restore stale shapes.
					await setCanvasSnapshotInCache(queryClient, canvasId, snapshot);
					const result = await saveMutation.mutateAsync({
						path: { id: canvasId },
						body: {
							snapshot,
							...(baseVersionRef.current
								? { baseUpdatedAt: baseVersionRef.current.updatedAt }
								: {}),
						},
					});
					baseVersionRef.current = {
						canvasId,
						updatedAt: result.updatedAt,
					};
					savedRevision = savingRevision;
					// Cancel once more after the mutation to catch a refetch that began
					// while the PUT was in flight.
					await setCanvasSnapshotInCache(
						queryClient,
						canvasId,
						snapshot,
						result.updatedAt,
					);
					if (pendingSave && savedRevision < revision) {
						const latestSnapshot = getSnapshot(editor.store)
							.document as unknown as Record<string, unknown>;
						pendingSave = rememberPendingCanvasSave(canvasId, {
							snapshot: latestSnapshot,
							baseUpdatedAt: result.updatedAt,
						});
					}
					setSaveError(null);
					return true;
				} catch (error) {
					if (error instanceof ContractError && error.status === 409) {
						conflictPending = true;
						const localSnapshot = getSnapshot(editor.store)
							.document as unknown as Record<string, unknown>;
						pendingSave = rememberPendingCanvasSave(canvasId, {
							snapshot: localSnapshot,
							baseUpdatedAt:
								baseVersionRef.current?.updatedAt ?? initialUpdatedAt,
						});
						try {
							// Refresh the server-state cache, but keep the conflict-protected
							// local snapshot in the mounted store and pending-save registry.
							const fresh = await refreshCanvasQuery(queryClient, canvasId);
							baseVersionRef.current = {
								canvasId,
								updatedAt: fresh.updatedAt,
							};
							pendingSave = rememberPendingCanvasSave(canvasId, {
								snapshot: localSnapshot,
								baseUpdatedAt: fresh.updatedAt,
							});
							setSaveError(CANVAS_CONFLICT_MESSAGE);
						} catch (refreshError) {
							setSaveError(
								userErrorMessage(
									refreshError,
									"Canvas changed elsewhere. Your drawing is still here, but the latest version could not be checked.",
								),
							);
						}
					} else {
						setSaveError(
							userErrorMessage(error, "Canvas changes could not be saved."),
						);
					}
					setSaveState("error");
					return false;
				}
			})();

			saveInFlight = request;
			const saved = await request;
			if (saveInFlight === request) saveInFlight = null;
			if (!saved) return false;
			if (savedRevision < revision) return save();
			if (pendingSave) {
				clearPendingCanvasSave(canvasId, pendingSave);
				pendingSave = null;
			}
			setSaveState("saved");
			return true;
		}

		const flush = () =>
			drainCanvasSaveQueue({
				clearPendingTimer: () => {
					if (pendingTimeout) {
						clearTimeout(pendingTimeout);
						pendingTimeout = null;
					}
				},
				hasPendingChanges: () =>
					savedRevision < revision || saveInFlight !== null,
				save,
			});
		flushRef.current = flush;
		retryRef.current = () => {
			conflictPending = false;
			return flush();
		};
		const unregisterFlusher = registerCanvasSaveFlusher(canvasId, flush);

		const unlisten = editor.store.listen(
			() => {
				revision += 1;
				if (pendingSave) {
					const latestSnapshot = getSnapshot(editor.store)
						.document as unknown as Record<string, unknown>;
					pendingSave = rememberPendingCanvasSave(canvasId, {
						snapshot: latestSnapshot,
						baseUpdatedAt:
							baseVersionRef.current?.updatedAt ?? pendingSave.baseUpdatedAt,
					});
				}
				if (pendingTimeout) clearTimeout(pendingTimeout);
				pendingTimeout = setTimeout(() => void flush(), SNAPSHOT_SAVE_DELAY_MS);
			},
			{ scope: "document", source: "user" },
		);

		return () => {
			unlisten();
			unregisterFlusher();
			void flush();
		};
	}

	return (
		<div className="relative h-full w-full">
			<TldrawWithFonts
				documentSnapshot={snapshot}
				licenseKey={TLDRAW_LICENSE_KEY}
				shapeUtils={haunterShapeUtils}
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
						onClick={() => void retryRef.current()}
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
	const flushRef = useRef<() => Promise<boolean>>(async () => true);

	function handleMount(editor: Editor) {
		syncCanvasTheme(editor);
		if (!canEdit) {
			editor.updateInstanceState({ isReadonly: true });
		}

		let revision = 0;
		let savedRevision = 0;
		let saveInFlight: Promise<boolean> | null = null;
		let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

		async function save(): Promise<boolean> {
			if (!canEdit) return true;
			if (saveInFlight) {
				const saved = await saveInFlight;
				return saved && savedRevision < revision ? save() : saved;
			}
			if (savedRevision >= revision) return true;

			const savingRevision = revision;
			setSaveError(null);
			setSaveState("saving");
			const document = getSnapshot(editor.store).document as unknown as Record<
				string,
				unknown
			>;
			const request = (async () => {
				try {
					await setCanvasSnapshotInCache(queryClient, canvasId, document);
					const result = await saveMutation.mutateAsync({
						path: { id: canvasId },
						body: { snapshot: document },
					});
					savedRevision = savingRevision;
					await setCanvasSnapshotInCache(
						queryClient,
						canvasId,
						document,
						result.updatedAt,
					);
					setSaveError(null);
					return true;
				} catch (error) {
					// Keep the shared document and local revision pending. A retry
					// materializes the current converged room state again.
					setSaveError(
						userErrorMessage(error, "Canvas changes could not be saved."),
					);
					setSaveState("error");
					return false;
				}
			})();

			saveInFlight = request;
			const saved = await request;
			if (saveInFlight === request) saveInFlight = null;
			if (!saved) return false;
			if (savedRevision < revision) return save();
			setSaveState("saved");
			return true;
		}

		const flush = () =>
			drainCanvasSaveQueue({
				clearPendingTimer: () => {
					if (pendingTimeout) {
						clearTimeout(pendingTimeout);
						pendingTimeout = null;
					}
				},
				hasPendingChanges: () =>
					savedRevision < revision || saveInFlight !== null,
				save,
			});
		flushRef.current = flush;
		const unregisterFlusher = registerCanvasSaveFlusher(canvasId, flush);

		// Local and remote document changes both reset the debounce. Concurrent
		// peers may initially persist partial snapshots, but once their Yjs
		// updates arrive every editor materializes and saves the converged room.
		const unlisten = editor.store.listen(
			() => {
				if (!canEdit) return;
				revision += 1;
				if (pendingTimeout) clearTimeout(pendingTimeout);
				pendingTimeout = setTimeout(() => void flush(), SNAPSHOT_SAVE_DELAY_MS);
			},
			{ scope: "document" },
		);

		return () => {
			unlisten();
			unregisterFlusher();
			void flush();
		};
	}

	return (
		<div className="relative h-full w-full">
			<TldrawWithFonts
				documentSnapshot={snapshot}
				licenseKey={TLDRAW_LICENSE_KEY}
				shapeUtils={haunterShapeUtils}
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
						onClick={() => void flushRef.current()}
					>
						Retry
					</Button>
				</div>
			) : null}
		</div>
	);
}
