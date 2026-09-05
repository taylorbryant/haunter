"use client";

import "tldraw/tldraw.css";

import { ContractError } from "@beignet/core/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
	createTLStore,
	defaultBindingUtils,
	type Editor,
	loadSnapshot,
} from "tldraw";
import { durableDraftCoordinator } from "@/client/durable-draft-coordinator";
import { useDurableDraftStorage } from "@/client/durable-draft-storage-provider";
import {
	DurableDraftController,
	type DurableDraftSnapshot,
} from "@/client/durable-drafts";
import { userErrorMessage } from "@/client/error-feedback";
import { localDraftKey } from "@/client/local-drafts";
import {
	getSessionExpiredSnapshot,
	isSessionExpiredError,
	reportSessionExpired,
} from "@/client/session-expiration";
import { useCurrentUser } from "@/components/app-session-provider";
import { Button } from "@/components/ui/button";
import {
	getCanvasQueryOptions,
	refreshCanvasQuery,
	saveCanvasSnapshotMutationOptions,
	setCanvasSnapshotInCache,
} from "@/features/canvases/client/queries";
import {
	type CanvasSaveState,
	registerCanvasSaveFlusher,
} from "@/features/canvases/client/save-state";
import { CANVAS_LIBRARY_COMPONENTS } from "@/features/canvases/components/canvas-library";
import SharedCanvasSurface from "@/features/canvases/components/shared-canvas-surface";
import { TldrawWithFonts } from "@/features/canvases/components/tldraw-with-fonts";
import { useCanvasTheme } from "@/features/canvases/components/use-canvas-theme";
import { haunterShapeUtils } from "@/features/canvases/lib/shape-utils";
import { loadableSnapshot } from "@/features/canvases/lib/snapshot";
import { TLDRAW_LICENSE_KEY } from "@/features/canvases/lib/tldraw-license";
import {
	type Canvas,
	type CanvasSnapshot,
	CanvasSnapshotSchema,
} from "@/features/canvases/schemas";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import { useSharedPageToken } from "@/features/shares/components/shared-page-context";

const SNAPSHOT_SAVE_DELAY_MS = 1500;

type CanvasSaveMetadata = Pick<Canvas, "updatedAt">;
type CanvasDraftController = DurableDraftController<
	CanvasSnapshot,
	CanvasSaveMetadata
>;

function serializeCanvasSnapshot(snapshot: CanvasSnapshot) {
	return JSON.stringify(snapshot, (_key, value: unknown) => {
		if (!value || typeof value !== "object" || Array.isArray(value))
			return value;
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
				left.localeCompare(right),
			),
		);
	});
}

export type { CanvasSaveState } from "@/features/canvases/client/save-state";

export default function CanvasSurface({
	canvasId,
	onSaveStateChange,
	layoutKey,
}: {
	canvasId: string;
	onSaveStateChange?: (state: CanvasSaveState) => void;
	layoutKey?: string;
}) {
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
	const canvasQuery = useQuery(getCanvasQueryOptions(canvasId));
	const canEdit = useCanEditWorkspace();
	const currentUser = useCurrentUser();

	if (canvasQuery.isPending) return <CanvasLoading />;

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

	if (canEdit && currentUser) {
		return (
			<DurableCanvasSurface
				key={`${currentUser.id}:${canvasId}`}
				canvas={canvasQuery.data}
				currentUserId={currentUser.id}
				layoutKey={layoutKey}
				onSaveStateChange={onSaveStateChange}
			/>
		);
	}

	return (
		<MountedCanvasSurface
			key={canvasId}
			controller={null}
			draft={savedCanvasDraft(canvasQuery.data)}
			editable={false}
			layoutKey={layoutKey}
			onSaveStateChange={onSaveStateChange}
		/>
	);
}

function CanvasLoading() {
	return (
		<div className="flex h-full items-center justify-center text-muted-foreground text-sm">
			Loading canvas…
		</div>
	);
}

function savedCanvasDraft(
	canvas: Canvas,
): DurableDraftSnapshot<CanvasSnapshot> {
	return {
		status: "saved",
		value: canvas.snapshot,
		serverValue: canvas.snapshot,
		serverVersion: canvas.snapshotUpdatedAt,
		error: null,
		validationError: null,
		dirty: false,
	};
}

function DurableCanvasSurface({
	canvas,
	currentUserId,
	layoutKey,
	onSaveStateChange,
}: {
	canvas: Canvas;
	currentUserId: string;
	layoutKey?: string;
	onSaveStateChange?: (state: CanvasSaveState) => void;
}) {
	const queryClient = useQueryClient();
	const storage = useDurableDraftStorage<CanvasSnapshot>();
	const saveMutation = useMutation({
		...saveCanvasSnapshotMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const lifecycleGeneration = useRef(0);
	const [controller] = useState(
		() =>
			new DurableDraftController<CanvasSnapshot, CanvasSaveMetadata>({
				identity: {
					key: localDraftKey(currentUserId, "canvas", canvas.id),
					userId: currentUserId,
					workspaceId: canvas.workspaceId,
					resourceType: "canvas",
					resourceId: canvas.id,
				},
				serverValue: canvas.snapshot,
				serverVersion: canvas.snapshotUpdatedAt,
				storage,
				localDebounceMs: 100,
				debounceMs: SNAPSHOT_SAVE_DELAY_MS,
				isPayload: (value): value is CanvasSnapshot =>
					CanvasSnapshotSchema.safeParse(value).success,
				areValuesEqual: (left, right) =>
					serializeCanvasSnapshot(left) === serializeCanvasSnapshot(right),
				isAuthError: isSessionExpiredError,
				isAuthExpired: getSessionExpiredSnapshot,
				onAuthError: reportSessionExpired,
				isConflictError: (error) =>
					error instanceof ContractError && error.status === 409,
				loadServer: async () => {
					const latest = await refreshCanvasQuery(queryClient, canvas.id);
					return {
						value: latest.snapshot,
						version: latest.snapshotUpdatedAt,
					};
				},
				onServerSaved: (result) => {
					if (!result.version) return;
					void setCanvasSnapshotInCache(queryClient, canvas.id, result.value, {
						updatedAt: result.metadata?.updatedAt ?? result.version,
						snapshotUpdatedAt: result.version,
					});
				},
				saveServer: async ({ value, baseVersion }) => {
					const result = await saveMutation.mutateAsync({
						path: { id: canvas.id },
						body: {
							snapshot: value,
							...(baseVersion ? { baseUpdatedAt: baseVersion } : {}),
						},
					});
					return {
						value,
						version: result.snapshotUpdatedAt,
						metadata: { updatedAt: result.updatedAt },
					};
				},
			}),
	);
	const draft = useSyncExternalStore(
		controller.subscribe,
		controller.getUncontrolledSnapshot,
		controller.getUncontrolledSnapshot,
	);

	useEffect(() => {
		const generation = ++lifecycleGeneration.current;
		controller.start();
		const unregisterDraft = durableDraftCoordinator.register(controller);
		const unregisterFlusher = registerCanvasSaveFlusher(canvas.id, () =>
			controller.flushServer(),
		);
		return () => {
			unregisterFlusher();
			unregisterDraft();
			queueMicrotask(() => {
				if (lifecycleGeneration.current !== generation) return;
				void controller.flushServer().finally(() => {
					if (lifecycleGeneration.current === generation) controller.stop();
				});
			});
		};
	}, [canvas.id, controller]);

	useEffect(() => {
		controller.refreshServer(canvas.snapshot, canvas.snapshotUpdatedAt);
	}, [canvas.snapshot, canvas.snapshotUpdatedAt, controller]);

	if (draft.status === "loading") return <CanvasLoading />;

	return (
		<MountedCanvasSurface
			controller={controller}
			draft={draft}
			editable
			layoutKey={layoutKey}
			onSaveStateChange={onSaveStateChange}
		/>
	);
}

function MountedCanvasSurface({
	controller,
	draft,
	editable,
	layoutKey,
	onSaveStateChange,
}: {
	controller: CanvasDraftController | null;
	draft: DurableDraftSnapshot<CanvasSnapshot>;
	editable: boolean;
	layoutKey?: string;
	onSaveStateChange?: (state: CanvasSaveState) => void;
}) {
	const { resolvedTheme } = useTheme();
	const syncCanvasTheme = useCanvasTheme(resolvedTheme);
	const editorRef = useRef<Editor | null>(null);
	const applyingActorValue = useRef(false);
	const projectedValue = useRef(draft.value);
	const [localStore] = useState(() =>
		createTLStore({
			shapeUtils: haunterShapeUtils,
			bindingUtils: defaultBindingUtils,
			snapshot: loadableSnapshot(draft.value),
		}),
	);
	const saveState: CanvasSaveState =
		draft.status === "saved"
			? "saved"
			: draft.status === "paused-auth"
				? "local"
				: draft.status === "saving-local" ||
						draft.status === "pending" ||
						draft.status === "syncing"
					? "saving"
					: "error";
	const isBusy =
		draft.status === "saving-local" ||
		draft.status === "syncing" ||
		draft.status === "resolving";
	const canvasEditable = editable && draft.status !== "resolving";
	const canRetry =
		draft.status === "storage-error" || draft.status === "sync-error";
	const saveError =
		draft.status === "storage-error"
			? userErrorMessage(
					draft.error,
					"Your drawing could not be saved in this browser.",
				)
			: draft.status === "sync-error"
				? "Your drawing is saved in this browser but could not be synced."
				: draft.status === "conflict" && draft.error
					? userErrorMessage(
							draft.error,
							"The canvas conflict could not be resolved.",
						)
					: null;

	useEffect(() => {
		onSaveStateChange?.(saveState);
	}, [onSaveStateChange, saveState]);

	useEffect(() => {
		const editor = editorRef.current;
		if (editor) editor.updateInstanceState({ isReadonly: !canvasEditable });
	}, [canvasEditable]);

	useEffect(() => {
		if (draft.status === "conflict" || projectedValue.current === draft.value) {
			return;
		}
		const snapshot = loadableSnapshot(draft.value);
		if (!snapshot) return;
		applyingActorValue.current = true;
		loadSnapshot(localStore, snapshot);
		projectedValue.current = draft.value;
		queueMicrotask(() => {
			applyingActorValue.current = false;
		});
	}, [draft.status, draft.value, localStore]);

	function handleMount(editor: Editor) {
		editorRef.current = editor;
		syncCanvasTheme(editor);
		editor.updateInstanceState({ isReadonly: !canvasEditable });

		const unlisten = controller
			? editor.store.listen(
					() => {
						if (applyingActorValue.current) return;
						const snapshot =
							editor.store.getStoreSnapshot() as unknown as CanvasSnapshot;
						projectedValue.current = snapshot;
						controller.edit(snapshot);
					},
					{ scope: "document", source: "user" },
				)
			: () => undefined;

		return () => {
			unlisten();
			if (editorRef.current === editor) editorRef.current = null;
		};
	}

	return (
		<div
			className="haunter-canvas relative h-full w-full"
			data-canvas-layout={layoutKey}
		>
			<TldrawWithFonts
				components={canvasEditable ? CANVAS_LIBRARY_COMPONENTS : undefined}
				documentSnapshot={loadableSnapshot(draft.value)}
				layoutKey={layoutKey}
				licenseKey={TLDRAW_LICENSE_KEY}
				shapeUtils={haunterShapeUtils}
				store={localStore}
				onMount={handleMount}
			/>
			{draft.status === "conflict" || draft.status === "resolving" ? (
				<div
					role="alert"
					className="absolute inset-x-2 bottom-28 z-[310] flex flex-col gap-2 rounded-lg border border-destructive/25 bg-background/95 px-3 py-2.5 text-sm shadow-md backdrop-blur-sm sm:right-2 sm:bottom-14 sm:left-auto sm:w-[32rem] sm:max-w-[calc(100%-1rem)] sm:flex-row sm:items-center"
				>
					<span className="min-w-0 flex-1 leading-snug text-destructive">
						Canvas changed elsewhere. Your drawing is still here.
						{saveError ? ` ${saveError}` : ""}
					</span>
					<div className="flex shrink-0 justify-end gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={isBusy}
							onClick={() => void controller?.useServer()}
						>
							Load latest
						</Button>
						<Button
							type="button"
							variant="destructive"
							size="sm"
							disabled={isBusy}
							onClick={() => void controller?.keepMine()}
						>
							Save my version
						</Button>
					</div>
				</div>
			) : saveState === "error" && saveError ? (
				<div
					role="alert"
					className="absolute right-2 bottom-14 z-10 flex max-w-xs items-center gap-2 rounded border border-destructive/30 bg-background/95 px-2 py-1.5 text-destructive text-xs shadow"
				>
					<span className="flex-1">{saveError}</span>
					{canRetry ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={isBusy}
							onClick={() => void controller?.retry()}
						>
							Retry
						</Button>
					) : null}
				</div>
			) : null}
		</div>
	);
}
