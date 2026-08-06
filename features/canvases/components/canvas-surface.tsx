"use client";

import "tldraw/tldraw.css";

import { ContractError } from "@beignet/core/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	createTLStore,
	defaultBindingUtils,
	type Editor,
	loadSnapshot,
} from "tldraw";
import { userErrorMessage } from "@/client/error-feedback";
import {
	deleteLocalDraft,
	getLocalDraft,
	hasLocalDraftHint,
	type LocalDraft,
	localDraftKey,
	putLocalDraft,
} from "@/client/local-drafts";
import { useCurrentUser } from "@/components/app-session-provider";
import { Button } from "@/components/ui/button";
import {
	getCanvasQueryOptions,
	refreshCanvasQuery,
	saveCanvasSnapshotMutationOptions,
	setCanvasSnapshotInCache,
} from "@/features/canvases/client/queries";
import {
	canvasPendingSaveKey,
	clearPendingCanvasSave,
	drainCanvasSaveQueue,
	getPendingCanvasSave,
	type PendingCanvasSave,
	registerCanvasSaveFlusher,
	rememberPendingCanvasSave,
} from "@/features/canvases/client/save-state";
import { CANVAS_LIBRARY_COMPONENTS } from "@/features/canvases/components/canvas-library";
import SharedCanvasSurface from "@/features/canvases/components/shared-canvas-surface";
import { TldrawWithFonts } from "@/features/canvases/components/tldraw-with-fonts";
import { useCanvasTheme } from "@/features/canvases/components/use-canvas-theme";
import { haunterShapeUtils } from "@/features/canvases/lib/shape-utils";
import { loadableSnapshot } from "@/features/canvases/lib/snapshot";
import { TLDRAW_LICENSE_KEY } from "@/features/canvases/lib/tldraw-license";
import type { CanvasSnapshot } from "@/features/canvases/schemas";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import { useSharedPageToken } from "@/features/shares/components/shared-page-context";

const SNAPSHOT_SAVE_DELAY_MS = 1500;
const CANVAS_CONFLICT_MESSAGE =
	"Canvas changed elsewhere. Your drawing is still here. Retry to keep this version.";

export type CanvasSaveState = "saved" | "saving" | "error";

export default function CanvasSurface({
	canvasId,
	onSaveStateChange,
	layoutKey,
}: {
	canvasId: string;
	onSaveStateChange?: (state: CanvasSaveState) => void;
	layoutKey?: string;
}) {
	// Inside a public share view, swap to the read-only token-scoped surface.
	const shareToken = useSharedPageToken();
	if (shareToken) {
		return (
			<SharedCanvasSurface
				token={shareToken}
				canvasId={canvasId}
				layoutKey={layoutKey}
			/>
		);
	}

	return (
		<MemberCanvasSurface
			canvasId={canvasId}
			onSaveStateChange={onSaveStateChange}
			layoutKey={layoutKey}
		/>
	);
}

function MemberCanvasSurface({
	canvasId,
	onSaveStateChange,
	layoutKey,
}: {
	canvasId: string;
	onSaveStateChange?: (state: CanvasSaveState) => void;
	layoutKey?: string;
}) {
	const { resolvedTheme } = useTheme();
	const syncCanvasTheme = useCanvasTheme(resolvedTheme);
	const queryClient = useQueryClient();
	const canvasQuery = useQuery(getCanvasQueryOptions(canvasId));
	const saveMutation = useMutation({
		...saveCanvasSnapshotMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const canEdit = useCanEditWorkspace();
	const currentUser = useCurrentUser();
	const pendingSaveKey = canvasPendingSaveKey(
		canvasId,
		currentUser?.id ?? null,
	);
	const recoveryKey = currentUser
		? localDraftKey(currentUser.id, "canvas", canvasId)
		: null;
	const shouldLoadRecovery =
		recoveryKey !== null && hasLocalDraftHint(recoveryKey);
	const [recoveryState, setRecoveryState] = useState<{
		key: string | null;
		draft: LocalDraft<CanvasSnapshot> | null;
	}>({ key: null, draft: null });
	const recoveryDraft =
		recoveryState.key === recoveryKey ? recoveryState.draft : undefined;
	useEffect(() => {
		if (!shouldLoadRecovery || !recoveryKey) return;
		let active = true;
		void getLocalDraft<CanvasSnapshot>(recoveryKey)
			.then((draft) => {
				if (active) setRecoveryState({ key: recoveryKey, draft });
			})
			.catch(() => {
				if (active) setRecoveryState({ key: recoveryKey, draft: null });
			});
		return () => {
			active = false;
		};
	}, [recoveryKey, shouldLoadRecovery]);
	const matchingRecoveryDraft =
		recoveryDraft &&
		canvasQuery.data &&
		recoveryDraft.workspaceId === canvasQuery.data.workspaceId
			? recoveryDraft
			: null;
	useEffect(() => {
		if (
			!recoveryKey ||
			!recoveryDraft ||
			!canvasQuery.data ||
			recoveryDraft.workspaceId === canvasQuery.data.workspaceId
		) {
			return;
		}
		void deleteLocalDraft(recoveryKey).catch(() => undefined);
	}, [canvasQuery.data, recoveryDraft, recoveryKey]);
	const recoveredPendingSave = useMemo<PendingCanvasSave | null>(
		() =>
			matchingRecoveryDraft
				? {
						snapshot: matchingRecoveryDraft.payload,
						baseUpdatedAt:
							matchingRecoveryDraft.baseVersion ??
							canvasQuery.data?.updatedAt ??
							"",
						requiresConfirmation: true,
					}
				: null,
		[canvasQuery.data?.updatedAt, matchingRecoveryDraft],
	);
	const pendingSaveAtRender =
		getPendingCanvasSave(pendingSaveKey) ?? recoveredPendingSave;

	const [saveState, setSaveState] = useState<CanvasSaveState>(
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
	const localDirtyRef = useRef(pendingSaveAtRender !== null);

	useEffect(() => {
		onSaveStateChange?.(saveState);
	}, [onSaveStateChange, saveState]);

	useEffect(() => {
		if (!recoveredPendingSave) return;
		if (getPendingCanvasSave(pendingSaveKey)) return;
		rememberPendingCanvasSave(pendingSaveKey, recoveredPendingSave);
		setSaveState("error");
		setSaveError(CANVAS_CONFLICT_MESSAGE);
	}, [pendingSaveKey, recoveredPendingSave]);

	if (canvasQuery.data && baseVersionRef.current?.canvasId !== canvasId) {
		baseVersionRef.current = {
			canvasId,
			updatedAt:
				pendingSaveAtRender?.baseUpdatedAt ?? canvasQuery.data.updatedAt,
		};
		// This component can be reused for a different canvas block. A dirty bit
		// from the previous store must not prevent the new canvas from accepting
		// workspace-event refreshes.
		localDirtyRef.current = pendingSaveAtRender !== null;
	}

	useEffect(() => {
		const data = canvasQuery.data;
		const store = localStoreRef.current;
		const base = baseVersionRef.current;
		if (
			!data ||
			!store ||
			store.canvasId !== canvasId ||
			!base ||
			base.canvasId !== canvasId ||
			base.updatedAt === data.updatedAt ||
			pendingSaveAtRender ||
			localDirtyRef.current ||
			saveState !== "saved" ||
			saveMutation.isPending
		) {
			return;
		}
		const remoteSnapshot = loadableSnapshot(data.snapshot);
		if (!remoteSnapshot) return;
		loadSnapshot(store.store, remoteSnapshot);
		baseVersionRef.current = { canvasId, updatedAt: data.updatedAt };
	}, [
		canvasId,
		canvasQuery.data,
		pendingSaveAtRender,
		saveMutation.isPending,
		saveState,
	]);

	if (
		canvasQuery.isPending ||
		(shouldLoadRecovery && recoveryDraft === undefined)
	) {
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
	const persistRecovery = async (
		snapshot: CanvasSnapshot,
		baseUpdatedAt: string,
	) => {
		if (!currentUser || !recoveryKey) return;
		await putLocalDraft({
			key: recoveryKey,
			userId: currentUser.id,
			workspaceId: canvasQuery.data.workspaceId,
			resourceType: "canvas",
			resourceId: canvasId,
			baseVersion: baseUpdatedAt,
			payload: structuredClone(snapshot),
			status: "conflict",
			updatedAt: new Date().toISOString(),
		});
	};
	const clearRecovery = async () => {
		if (!recoveryKey) return;
		try {
			await deleteLocalDraft(recoveryKey);
		} finally {
			setRecoveryState((current) =>
				current.key === recoveryKey
					? { key: recoveryKey, draft: null }
					: current,
			);
		}
	};

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
			const snapshot = editor.store.getStoreSnapshot() as unknown as Record<
				string,
				unknown
			>;
			const request = (async () => {
				try {
					try {
						await persistRecovery(
							snapshot,
							baseVersionRef.current?.updatedAt ?? initialUpdatedAt,
						);
					} catch {
						// The mounted tldraw store still protects the drawing for this
						// session; the server save must not be blocked by local storage.
					}
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
						const latestSnapshot =
							editor.store.getStoreSnapshot() as unknown as Record<
								string,
								unknown
							>;
						pendingSave = rememberPendingCanvasSave(pendingSaveKey, {
							snapshot: latestSnapshot,
							baseUpdatedAt: result.updatedAt,
						});
					}
					setSaveError(null);
					return true;
				} catch (error) {
					if (error instanceof ContractError && error.status === 409) {
						conflictPending = true;
						const localSnapshot =
							editor.store.getStoreSnapshot() as unknown as Record<
								string,
								unknown
							>;
						pendingSave = rememberPendingCanvasSave(pendingSaveKey, {
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
							pendingSave = rememberPendingCanvasSave(pendingSaveKey, {
								snapshot: localSnapshot,
								baseUpdatedAt: fresh.updatedAt,
							});
							await persistRecovery(localSnapshot, fresh.updatedAt);
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
				clearPendingCanvasSave(pendingSaveKey, pendingSave);
				pendingSave = null;
			}
			await clearRecovery().catch(() => undefined);
			localDirtyRef.current = false;
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
				localDirtyRef.current = true;
				revision += 1;
				if (pendingSave) {
					const latestSnapshot =
						editor.store.getStoreSnapshot() as unknown as Record<
							string,
							unknown
						>;
					pendingSave = rememberPendingCanvasSave(pendingSaveKey, {
						snapshot: latestSnapshot,
						baseUpdatedAt:
							baseVersionRef.current?.updatedAt ?? pendingSave.baseUpdatedAt,
					});
					void persistRecovery(
						latestSnapshot,
						baseVersionRef.current?.updatedAt ?? pendingSave.baseUpdatedAt,
					).catch(() => undefined);
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
		<div
			className="haunter-canvas relative h-full w-full"
			data-canvas-layout={layoutKey}
		>
			<TldrawWithFonts
				components={canEdit ? CANVAS_LIBRARY_COMPONENTS : undefined}
				documentSnapshot={snapshot}
				layoutKey={layoutKey}
				licenseKey={TLDRAW_LICENSE_KEY}
				shapeUtils={haunterShapeUtils}
				store={localStore}
				onMount={handleMount}
			/>
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
