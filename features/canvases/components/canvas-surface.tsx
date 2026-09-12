"use client";
import "tldraw/tldraw.css";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSync, type UseSyncConnectFn } from "@tldraw/sync";
import { AuthenticatedCanvasSocket } from "../client/authenticated-socket";
import {
	atom,
	UserRecordType,
	inlineBase64AssetStore,
	type Editor,
	type TLStoreSnapshot,
} from "tldraw";
import { apiClient } from "@/client";
import { draftRegistry } from "@/client/draft-registry";
import { getBrowserSessionRecovery } from "@/client/session-recovery";
import { useCurrentUser } from "@/components/app-session-provider";
import { Button } from "@/components/ui/button";
import { useDurableDraftStorage } from "@/client/durable-draft-storage-provider";
import { listLocalCanvasDrafts, type LocalDraft } from "@/client/local-drafts";
import { downloadRecoveryDrafts } from "@/client/draft-export";
import { getCanvasQueryOptions } from "../client/queries";
import {
	registerCanvasSaveFlusher,
	type CanvasSaveState,
} from "../client/save-state";
import { CanvasSyncRecovery } from "../client/sync-recovery";
import { CANVAS_LIBRARY_COMPONENTS } from "./canvas-library";
import SharedCanvasSurface from "./shared-canvas-surface";
import { TldrawWithFonts } from "./tldraw-with-fonts";
import { useCanvasTheme } from "./use-canvas-theme";
import { haunterShapeUtils } from "../lib/shape-utils";
import { canvasFingerprint } from "../lib/document";
import { TLDRAW_LICENSE_KEY } from "../lib/tldraw-license";
import { useCanEditWorkspace } from "@/features/members/client/use-workspace-role";
import { useSharedPageToken } from "@/features/shares/components/shared-page-context";
import {
	openCanvasSession,
	importRecovery,
} from "@/features/documents/contracts";
import { useRouter } from "next/navigation";
export type { CanvasSaveState } from "../client/save-state";
type Props = {
	canvasId: string;
	onSaveStateChange?: (state: CanvasSaveState) => void;
	layoutKey?: string;
};
export default function CanvasSurface(props: Props) {
	const shareToken = useSharedPageToken();
	if (shareToken)
		return (
			<SharedCanvasSurface
				token={shareToken}
				canvasId={props.canvasId}
				layoutKey={props.layoutKey}
			/>
		);
	return <MemberCanvasSurface {...props} />;
}
function MemberCanvasSurface(props: Props) {
	const [retryKey, setRetryKey] = useState(0);
	const canvasQuery = useQuery(getCanvasQueryOptions(props.canvasId));
	const currentUser = useCurrentUser();
	const canEdit = useCanEditWorkspace();
	if (canvasQuery.isPending) return <CanvasLoading />;
	if (!canvasQuery.data || !currentUser)
		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 text-sm">
				<p>This canvas could not be loaded.</p>
				<Button onClick={() => void canvasQuery.refetch()}>Try again</Button>
			</div>
		);
	return (
		<CollaborativeCanvasSurface
			key={`${currentUser.id}:${props.canvasId}:${retryKey}`}
			onRestart={() => setRetryKey((key) => key + 1)}
			{...props}
			workspaceId={canvasQuery.data.workspaceId}
			user={currentUser}
			editable={canEdit}
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
function CollaborativeCanvasSurface({
	canvasId,
	workspaceId,
	user,
	editable,
	layoutKey,
	onSaveStateChange,
	onRestart,
}: Props & {
	onRestart: () => void;
	workspaceId: string;
	user: { id: string; name: string };
	editable: boolean;
}) {
	const { resolvedTheme } = useTheme();
	const syncTheme = useCanvasTheme(resolvedTheme);
	const storage = useDurableDraftStorage<TLStoreSnapshot>();
	const adapter = useRef<AuthenticatedCanvasSocket | null>(null);
	const recovery = useRef<CanvasSyncRecovery | null>(null);
	const receipt = useRef<string | null>(null);
	const [initialFingerprint, setInitialFingerprint] = useState<string | null>(
		null,
	);
	const [saveState, setSaveState] = useState<CanvasSaveState>("saved");
	const [localError, setLocalError] = useState(false);
	const [locallySaved, setLocallySaved] = useState(true);

	const [users] = useState(() => ({
		currentUser: atom(
			"canvas user",
			UserRecordType.create({
				id: UserRecordType.createId(user.id),
				name: user.name,
				color: "#8b5cf6",
			}),
		),
	}));
	const connect = useCallback<UseSyncConnectFn>(
		(query) => {
			const socket = new AuthenticatedCanvasSocket(async () => {
				const session = getBrowserSessionRecovery();
				if (session?.userId !== user.id || session.getSnapshot().blocked)
					throw new Error("Sign in to resume canvas sync");
				const epoch = session.epoch;
				const result = await apiClient
					.endpoint(openCanvasSession)
					.call({ path: { id: canvasId }, body: {} });
				if (
					getBrowserSessionRecovery() !== session ||
					session.epoch !== epoch ||
					session.getSnapshot().blocked
				)
					throw new Error("Session changed");
				const url = new URL(process.env.NEXT_PUBLIC_COLLABORATION_URL!);
				url.pathname = `/canvas/${canvasId}`;
				url.search = "";
				url.searchParams.set("token", result.token);
				url.searchParams.set("sessionId", query.sessionId);
				url.searchParams.set("storeId", query.storeId);
				return url.toString();
			});
			adapter.current = socket;
			return socket;
		},
		[canvasId, user.id],
	);
	const synced = useSync({
		connect,
		assets: inlineBase64AssetStore,
		shapeUtils: haunterShapeUtils,
		users,
		onCustomMessageReceived(message) {
			if (
				message &&
				typeof message === "object" &&
				"type" in message &&
				message.type === "canvas-saved" &&
				"fingerprint" in message &&
				typeof message.fingerprint === "string"
			) {
				setInitialFingerprint(
					(previous) => previous ?? (message.fingerprint as string),
				);
				receipt.current = message.fingerprint;
				recovery.current?.acknowledge(message.fingerprint);
			}
		},
	});
	useEffect(() => {
		const session = getBrowserSessionRecovery();
		if (!session) return;
		let epoch = session.epoch,
			blocked = session.getSnapshot().blocked;
		return session.subscribe(() => {
			const next = session.getSnapshot().blocked;
			if (epoch !== session.epoch || blocked !== next) {
				epoch = session.epoch;
				blocked = next;
				adapter.current?.restart();
			}
		});
	}, []);
	const store = synced.status === "synced-remote" ? synced.store : null;
	const connected =
		synced.status === "synced-remote" && synced.connectionStatus === "online";
	useEffect(() => {
		if (!store) return;
		const controller = new CanvasSyncRecovery(
			store,
			{ userId: user.id, workspaceId, resourceId: canvasId },
			storage,
			() => {
				if (adapter.current && !adapter.current.isDisposed)
					adapter.current.restart();
			},
		);
		recovery.current = controller;
		if (receipt.current) controller.acknowledge(receipt.current);
		const update = () => {
			const state = controller.getSnapshot();
			setSaveState(
				state.error
					? "error"
					: state.remotePaused
						? "paused"
						: state.dirty
							? "saving"
							: "saved",
			);
			setLocalError(!!state.error);
			setLocallySaved(state.locallySaved !== false);
		};
		const unsubscribe = controller.subscribe(update),
			unregister = draftRegistry.register(controller),
			unflush = registerCanvasSaveFlusher(canvasId, controller.flushServer);
		const flush = () => void controller.flushLocal().catch(() => {});
		window.addEventListener("pagehide", flush);
		window.addEventListener("beforeunload", flush);
		update();
		return () => {
			controller.dispose();
			unsubscribe();
			unregister();
			unflush();
			window.removeEventListener("pagehide", flush);
			window.removeEventListener("beforeunload", flush);
			if (recovery.current === controller) recovery.current = null;
		};
	}, [store, canvasId, workspaceId, user.id, storage]);
	useEffect(() => {
		onSaveStateChange?.(
			synced.status === "error"
				? "error"
				: synced.status === "loading"
					? "saving"
					: saveState,
		);
	}, [saveState, synced.status, onSaveStateChange]);
	const editor = useRef<Editor | null>(null);
	useEffect(() => {
		const value = editor.current;
		value?.updateInstanceState({
			isReadonly:
				!editable ||
				value.store.props.collaboration?.mode?.get() === "readonly",
		});
	}, [editable]);
	const error =
		synced.status === "error"
			? "Canvas sync could not connect. Your recovery copies are still available."
			: localError
				? "Browser recovery storage is unavailable. Keep this tab open until saved, or download a copy."
				: null;
	return (
		<div
			className="haunter-canvas relative h-full w-full"
			data-canvas-layout={layoutKey}
		>
			<CanvasRecoveryCopies
				canvasId={canvasId}
				workspaceId={workspaceId}
				userId={user.id}
				initialFingerprint={initialFingerprint}
			/>
			{store ? (
				<TldrawWithFonts
					components={editable ? CANVAS_LIBRARY_COMPONENTS : undefined}
					documentSnapshot={store.getStoreSnapshot()}
					layoutKey={layoutKey}
					licenseKey={TLDRAW_LICENSE_KEY}
					shapeUtils={haunterShapeUtils}
					store={synced}
					onMount={(value) => {
						editor.current = value;
						value.user.updateUserPreferences({
							id: user.id,
							name: user.name,
							color: "#8b5cf6",
						});
						syncTheme(value);
						value.updateInstanceState({
							isReadonly:
								!editable ||
								value.store.props.collaboration?.mode?.get() === "readonly",
						});
						return () => {
							editor.current = null;
						};
					}}
				/>
			) : (
				<CanvasLoading />
			)}
			<span
				className="sr-only"
				role="status"
				data-testid="canvas-document-status"
			>
				{error ??
					(!store
						? "Connecting to canvas…"
						: saveState === "saved"
							? "Saved"
							: !connected && locallySaved
								? "Saved in this browser · Offline"
								: "Saving…")}
			</span>
			{(error || !connected) && (
				<div
					role={error ? "alert" : "status"}
					className="absolute inset-x-2 bottom-14 z-[310] flex flex-wrap items-center gap-2 rounded border bg-background/95 px-3 py-2 text-xs shadow sm:left-auto sm:max-w-md"
				>
					<span>
						{error ??
							(store
								? "Offline · Keep this tab open to sync automatically. After a reload, use the recovery copy."
								: "Connecting to canvas…")}
					</span>
					<Button
						size="sm"
						variant="outline"
						onClick={() => {
							if (synced.status === "error") onRestart();
							else adapter.current?.restart();
						}}
					>
						Retry
					</Button>
					{store && (
						<Button
							size="sm"
							variant="outline"
							onClick={() => downloadRecoveryDrafts(user.id)}
						>
							Download copy
						</Button>
					)}
				</div>
			)}
		</div>
	);
}
function CanvasRecoveryCopies({
	canvasId,
	workspaceId,
	userId,
	initialFingerprint,
}: {
	canvasId: string;
	workspaceId: string;
	userId: string;
	initialFingerprint: string | null;
}) {
	const storage = useDurableDraftStorage<TLStoreSnapshot>();
	const router = useRouter();
	const [copies, setCopies] = useState<LocalDraft<TLStoreSnapshot>[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [requestId] = useState(() => crypto.randomUUID());
	useEffect(() => {
		let active = true;
		void listLocalCanvasDrafts<TLStoreSnapshot>(userId, workspaceId, canvasId)
			.then((rows) => {
				if (active)
					setCopies(
						rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
					);
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, [userId, workspaceId, canvasId]);
	useEffect(() => {
		if (!initialFingerprint || !copies.length) return;
		let active = true;
		void Promise.all(
			copies.map(async (copy) => {
				if ((await canvasFingerprint(copy.payload)) !== initialFingerprint)
					return copy;
				await storage.discard(copy.key);
				return null;
			}),
		)
			.then((rows) => {
				if (active && rows.some((row) => row === null))
					setCopies(
						rows.filter(
							(row): row is LocalDraft<TLStoreSnapshot> => row !== null,
						),
					);
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, [copies, initialFingerprint, storage]);
	if (!copies.length) return null;
	const copy = copies[0]!;
	const file = JSON.stringify({
		format: "haunter-draft-recovery",
		version: 1,
		pages: [],
		canvases: [{ id: canvasId, snapshot: copy.payload }],
	});
	return (
		<div
			role="alert"
			className="absolute inset-x-2 top-2 z-[310] flex flex-wrap items-center gap-2 rounded border bg-background/95 p-2 text-xs shadow"
		>
			<span>
				{error ??
					`An unsynced drawing copy from ${new Date(copy.updatedAt).toLocaleString()} is saved in this browser.${copies.length > 1 ? ` ${copies.length} copies are available, newest first.` : ""} Recover it as a separate canvas to keep both versions.`}
			</span>
			<Button
				size="sm"
				disabled={busy}
				onClick={async () => {
					setBusy(true);
					setError(null);
					try {
						const result = await apiClient.endpoint(importRecovery).call({
							idempotencyKey: `${requestId}:${await canvasFingerprint(copy.payload)}`,
							body: { workspaceId, filename: "canvas-recovery.json", file },
						});
						if (!result.canvasIds[0])
							throw new Error("No recovery canvas returned");
						await storage.discard(copy.key);
						setCopies((rows) => rows.filter((row) => row.key !== copy.key));
						router.push(`/w/${workspaceId}/c/${result.canvasIds[0]}`);
					} catch {
						setError(
							"Recovery could not finish. Your browser copy is still here.",
						);
					} finally {
						setBusy(false);
					}
				}}
			>
				Recover as new canvas
			</Button>
			<Button
				size="sm"
				variant="outline"
				onClick={() => {
					const url = URL.createObjectURL(
						new Blob([file], { type: "application/json" }),
					);
					const a = document.createElement("a");
					a.href = url;
					a.download = "canvas-recovery.json";
					a.click();
					setTimeout(() => URL.revokeObjectURL(url), 1000);
				}}
			>
				Download copy
			</Button>
			<Button
				size="sm"
				variant="ghost"
				disabled={busy}
				onClick={async () => {
					try {
						await storage.discard(copy.key);
						setCopies((rows) => rows.filter((row) => row.key !== copy.key));
					} catch {
						setError("The copy could not be discarded.");
					}
				}}
			>
				Discard copy
			</Button>
		</div>
	);
}
