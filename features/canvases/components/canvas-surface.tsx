"use client";

import "tldraw/tldraw.css";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { createTLStore, defaultBindingUtils, type Editor } from "tldraw";
import { userErrorMessage } from "@/client/error-feedback";
import { useCurrentUser } from "@/components/app-session-provider";
import { Button } from "@/components/ui/button";
import {
	getCanvasQueryOptions,
	setCanvasSnapshotInCache,
} from "@/features/canvases/client/queries";
import {
	drainCanvasSaveQueue,
	registerCanvasSaveFlusher,
} from "@/features/canvases/client/save-state";
import { CANVAS_LIBRARY_COMPONENTS } from "@/features/canvases/components/canvas-library";
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
	waitForCollabPersistence,
} from "@/features/collab/client/session";
import { cursorColorFor, documentRoomId } from "@/features/collab/lib/room";
import { queueMaterialization } from "@/features/documents/client/materialization";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import { useSharedPageToken } from "@/features/shares/components/shared-page-context";

const SNAPSHOT_SAVE_DELAY_MS = 1500;

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
	const collabSession = useCollabSession(documentRoomId("canvas", canvasId));
	const canEdit = useCanEditWorkspace();

	if (canvasQuery.isPending || collabSession.status === "connecting") {
		return <CanvasLoading />;
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

	if (collabSession.status === "unavailable") {
		return (
			<ProjectedCanvasSurface
				snapshot={canvasQuery.data.snapshot}
				layoutKey={layoutKey}
			/>
		);
	}

	return (
		<CollabCanvasSurface
			canvasId={canvasId}
			room={collabSession.room}
			snapshot={canvasQuery.data.snapshot}
			canEdit={canEdit}
			onSaveStateChange={onSaveStateChange}
			layoutKey={layoutKey}
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

function ProjectedCanvasSurface({
	snapshot,
	layoutKey,
}: {
	snapshot: Record<string, unknown>;
	layoutKey?: string;
}) {
	const { resolvedTheme } = useTheme();
	const syncCanvasTheme = useCanvasTheme(resolvedTheme);
	const store = useMemo(
		() =>
			createTLStore({
				shapeUtils: haunterShapeUtils,
				bindingUtils: defaultBindingUtils,
				snapshot: loadableSnapshot(snapshot),
			}),
		[snapshot],
	);

	return (
		<div
			className="haunter-canvas relative h-full w-full"
			data-canvas-layout={layoutKey}
		>
			<TldrawWithFonts
				documentSnapshot={loadableSnapshot(snapshot)}
				layoutKey={layoutKey}
				licenseKey={TLDRAW_LICENSE_KEY}
				shapeUtils={haunterShapeUtils}
				store={store}
				onMount={(editor) => {
					syncCanvasTheme(editor);
					editor.updateInstanceState({ isReadonly: true });
				}}
			/>
			<div className="absolute top-2 left-1/2 z-10 -translate-x-1/2 rounded border bg-background/95 px-3 py-1.5 text-center text-muted-foreground text-xs shadow">
				Live editing is temporarily unavailable. Showing the latest saved canvas
				read-only.
			</div>
		</div>
	);
}

function CollabCanvasSurface({
	canvasId,
	room,
	snapshot,
	canEdit,
	onSaveStateChange,
	layoutKey,
}: {
	canvasId: string;
	room: CollabRoom;
	snapshot: Record<string, unknown>;
	canEdit: boolean;
	onSaveStateChange?: (state: CanvasSaveState) => void;
	layoutKey?: string;
}) {
	const { resolvedTheme } = useTheme();
	const syncCanvasTheme = useCanvasTheme(resolvedTheme);
	const queryClient = useQueryClient();
	const currentUser = useCurrentUser();
	const collabUser: CanvasCollabUser | undefined = currentUser
		? {
				id: currentUser.id,
				name: currentUser.name || currentUser.email || "Member",
				color: cursorColorFor(currentUser.id),
			}
		: undefined;
	const storeWithStatus = useCollabCanvasStore(
		room,
		snapshot,
		collabUser,
		canEdit,
	);
	const synchronizedSnapshot = useMemo(() => {
		if (storeWithStatus.status !== "synced-remote") return null;
		return storeWithStatus.store.getStoreSnapshot() as unknown as Record<
			string,
			unknown
		>;
	}, [storeWithStatus]);
	const [saveState, setSaveState] = useState<CanvasSaveState>("saved");
	const [saveError, setSaveError] = useState<string | null>(null);
	const flushRef = useRef<() => Promise<boolean>>(async () => true);

	useEffect(() => {
		onSaveStateChange?.(saveState);
	}, [onSaveStateChange, saveState]);

	function handleMount(editor: Editor) {
		syncCanvasTheme(editor);
		if (!canEdit) editor.updateInstanceState({ isReadonly: true });

		let revision = 0;
		let savedRevision = 0;
		let saveInFlight: Promise<boolean> | null = null;
		let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

		async function save(): Promise<boolean> {
			if (!canEdit || savedRevision >= revision) return true;
			if (saveInFlight) {
				const saved = await saveInFlight;
				return saved && savedRevision < revision ? save() : saved;
			}

			const savingRevision = revision;
			setSaveError(null);
			setSaveState("saving");
			const document = editor.store.getStoreSnapshot() as unknown as Record<
				string,
				unknown
			>;
			const request = (async () => {
				try {
					await setCanvasSnapshotInCache(queryClient, canvasId, document);
					if (!(await waitForCollabPersistence(room))) {
						throw new Error("The shared canvas did not finish synchronizing.");
					}
					await queueMaterialization("canvas", canvasId);
					savedRevision = savingRevision;
					return true;
				} catch (error) {
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
					if (pendingTimeout) clearTimeout(pendingTimeout);
					pendingTimeout = null;
				},
				hasPendingChanges: () =>
					savedRevision < revision || saveInFlight !== null,
				save,
			});
		flushRef.current = flush;
		const unregisterFlusher = registerCanvasSaveFlusher(canvasId, flush);
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

	if (!synchronizedSnapshot) return <CanvasLoading />;

	return (
		<div
			className="haunter-canvas relative h-full w-full"
			data-canvas-layout={layoutKey}
		>
			<TldrawWithFonts
				components={canEdit ? CANVAS_LIBRARY_COMPONENTS : undefined}
				documentSnapshot={synchronizedSnapshot}
				layoutKey={layoutKey}
				licenseKey={TLDRAW_LICENSE_KEY}
				shapeUtils={haunterShapeUtils}
				store={storeWithStatus}
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
						onClick={() => void flushRef.current()}
					>
						Retry
					</Button>
				</div>
			) : null}
		</div>
	);
}
