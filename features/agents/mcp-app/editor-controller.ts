import type { AppThemeId } from "@/lib/themes";
import {
	EditorMessageSchema,
	type EditorOutput,
	type CanvasSelection,
	type EditorWorkspaceRequest,
	validateEditorOutput,
} from "./editor-schema";

type SaveResult = { locallySaved: boolean; saved: boolean };
type Bridge = {
	callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
	openLink(url: string): Promise<void>;
	canUseContext(): boolean;
};

/** Owns the authenticated frame. Navigation never discards an unconfirmed save. */
export function createEditorFrame(
	bridge: Bridge,
	options: {
		frame: HTMLIFrameElement;
		status(text: string): void;
		ready(value: boolean): void;
		contextChanged(): void;
		openCanvas(canvasId: string): Promise<void>;
		openPage(pageId: string, workspaceId?: string): Promise<void>;
		workspaceRequest?(request: EditorWorkspaceRequest): Promise<unknown>;
		metadata(
			value: { title: string; icon: string | null },
			page: EditorOutput,
		): void;
	},
) {
	const { frame } = options;
	let page: EditorOutput | undefined;
	let nonce = "";
	let canvasSelection: CanvasSelection | undefined;
	let selection: { text: string; complete: boolean } | undefined;
	let inlineCanvas:
		| { canvasId: string; selection: CanvasSelection }
		| undefined;
	const requests = new Set<string>();
	let mounted = false;
	let connected = false;
	let ready = false;
	let status: "opening" | "ready" | "unavailable" = "opening";
	let saveStatus: "unknown" | "saved" | "unsaved" = "unknown";
	let theme: AppThemeId = "light";
	let loadingTimer: ReturnType<typeof setTimeout> | undefined;
	let flush:
		| {
				id: string;
				resolve(value: SaveResult): void;
				reject(error: Error): void;
				timer: ReturnType<typeof setTimeout>;
		  }
		| undefined;
	const send = (message: Record<string, unknown>) => {
		// Before the first verified message, the iframe may still be about:blank
		// with the host's origin, or its navigation may have been blocked.
		if (page && connected)
			frame.contentWindow?.postMessage(
				{ ...message, nonce },
				new URL(page.editorUrl).origin,
			);
	};
	function resume() {
		frame.inert = false;
		send({ type: "haunter/editor/resume" });
	}
	async function save(pause = false): Promise<SaveResult> {
		if (!page || frame.hidden || !mounted)
			return { locallySaved: true, saved: true };
		if (flush)
			throw new Error("Wait for the current save to finish, then try again.");
		if (pause) frame.inert = true;
		const id = crypto.randomUUID();
		return new Promise((resolve, reject) => {
			flush = {
				id,
				resolve,
				reject,
				timer: setTimeout(() => {
					flush = undefined;
					resume();
					reject(
						new Error(
							"The editor did not confirm saving. Your page is still open; check the connection and try again.",
						),
					);
				}, 8000),
			};
			send({ type: "haunter/editor/flush", requestId: id, pause });
		});
	}
	async function prepareClose() {
		const result = await save(true);
		if (!result.locallySaved || !result.saved) {
			resume();
			throw new Error(
				"Your changes have not finished saving. Keep this page open and try again when it reconnects.",
			);
		}
		return result;
	}
	function reset() {
		clearTimeout(loadingTimer);
		frame.hidden = true;
		frame.src = "about:blank";
		frame.inert = false;
		page = undefined;
		canvasSelection = undefined;
		selection = undefined;
		inlineCanvas = undefined;
		mounted = false;
		connected = false;
		ready = false;
		status = "opening";
		saveStatus = "unknown";
		options.ready(false);
		options.contextChanged();
	}
	async function initialize(input: unknown) {
		const next = validateEditorOutput(input);
		if (page?.editorUrl === next.editorUrl && !frame.hidden) return;
		await prepareClose();
		reset();
		page = next;
		nonce = crypto.randomUUID();
		const url = new URL(next.editorUrl);
		url.searchParams.set("parentOrigin", window.location.origin);
		url.searchParams.set("nonce", nonce);
		frame.src = url.href;
		frame.title = `${next.title || "Untitled page"} — Haunter editor`;
		frame.hidden = false;
		loadingTimer = setTimeout(
			() =>
				options.status(
					"Haunter has not confirmed opening. Check the connection, then return Home and reopen the page.",
				),
			12_000,
		);
		// The embedded editor owns the loading view; reserve shell notices for errors.
		options.status("");
	}
	async function handleMessage(event: MessageEvent) {
		if (
			!page ||
			frame.hidden ||
			event.source !== frame.contentWindow ||
			event.origin !== new URL(page.editorUrl).origin
		)
			return;
		const parsed = EditorMessageSchema.safeParse(event.data);
		if (!parsed.success || parsed.data.nonce !== nonce) return;
		connected = true;
		const message = parsed.data;
		if (message.type === "haunter/editor/authorize") {
			const selected = page;
			const selectedNonce = nonce;
			try {
				const handoff = await bridge.callTool("authorize_haunter_editor", {
					workspaceId: selected.workspaceId,
					...(selected.canvasId
						? { canvasId: selected.canvasId }
						: { pageId: selected.pageId }),
					challenge: message.challenge,
				});
				if (selected === page && selectedNonce === nonce)
					send({
						type: "haunter/editor/authorized",
						requestId: message.requestId,
						handoff,
					});
			} catch {
				if (selected === page && selectedNonce === nonce)
					send({
						type: "haunter/editor/authorized",
						requestId: message.requestId,
						error:
							"Haunter could not authorize this editor. Reconnect Haunter and try again.",
					});
			}
		} else if (
			message.type === "haunter/editor/workspace-request" &&
			ready &&
			!flush &&
			!page.canvasId &&
			options.workspaceRequest
		) {
			if (requests.has(message.requestId)) return;
			requests.add(message.requestId);
			const selectedNonce = nonce;
			try {
				const result = await options.workspaceRequest(message.request);
				if (nonce === selectedNonce)
					send({
						type: "haunter/editor/workspace-result",
						requestId: message.requestId,
						result,
					});
			} catch (error) {
				if (nonce === selectedNonce)
					send({
						type: "haunter/editor/workspace-result",
						requestId: message.requestId,
						error:
							error instanceof Error
								? error.message
								: "Haunter could not complete this action.",
					});
			} finally {
				requests.delete(message.requestId);
			}
		} else if (message.type === "haunter/editor/status") {
			clearTimeout(loadingTimer);
			ready = message.status === "ready";
			status = ready
				? "ready"
				: message.status === "opening"
					? "opening"
					: "unavailable";
			if (!ready) {
				saveStatus = "unknown";
				selection = undefined;
				inlineCanvas = undefined;
				canvasSelection = undefined;
			}
			mounted ||= ready;
			options.status(
				ready
					? ""
					: message.status === "opening"
						? ""
						: message.status === "sign-in-required"
							? "Reconnect Haunter to authorize this editor, then retry."
							: "This Haunter account cannot open the selected page.",
			);
			send({ type: "haunter/editor/theme", theme });
			send({
				type: "haunter/editor/context-support",
				available: bridge.canUseContext(),
			});
			options.ready(ready);
			options.contextChanged();
		} else if (message.type === "haunter/editor/flushed") {
			if (flush?.id === message.requestId) {
				clearTimeout(flush.timer);
				flush.resolve(message);
				flush = undefined;
			}
		} else if (
			message.type === "haunter/editor/open-canvas" &&
			ready &&
			!flush &&
			!page.canvasId
		) {
			await options.openCanvas(message.canvasId);
		} else if (message.type === "haunter/editor/open-page" && ready && !flush) {
			await options.openPage(message.pageId, message.workspaceId);
		} else if (
			message.type === "haunter/editor/canvas-selection" &&
			ready &&
			page.canvasId
		) {
			canvasSelection = message.selection;
			options.contextChanged();
		} else if (
			message.type === "haunter/editor/inline-canvas-selection" &&
			ready &&
			!flush &&
			!page.canvasId
		) {
			inlineCanvas =
				message.canvasId && message.selection
					? { canvasId: message.canvasId, selection: message.selection }
					: undefined;
			if (inlineCanvas) selection = undefined;
			options.contextChanged();
		} else if (message.type === "haunter/editor/metadata") {
			options.metadata(message, page);
		} else if (message.type === "haunter/editor/save-status") {
			saveStatus = status === "unavailable" ? "unknown" : message.status;
			options.contextChanged();
		} else if (message.type === "haunter/editor/open-web") {
			await bridge.openLink(page.webUrl);
		} else if (
			message.type === "haunter/editor/selection" &&
			ready &&
			!flush &&
			!page.canvasId
		) {
			selection = message.text
				? { text: message.text, complete: message.complete }
				: undefined;
			if (selection) inlineCanvas = undefined;
			options.contextChanged();
		}
	}
	const listener = (event: MessageEvent) => {
		void handleMessage(event).catch(() =>
			options.status("Haunter could not complete this action."),
		);
	};
	window.addEventListener("message", listener);
	return {
		get context() {
			return {
				page,
				status,
				saveStatus,
				canvasSelection: status === "ready" ? canvasSelection : undefined,
				selection: status === "ready" ? selection : undefined,
				inlineCanvas: status === "ready" ? inlineCanvas : undefined,
			};
		},
		initialize,
		discardSaved: reset,
		save,
		prepareClose,
		resume,
		async close() {
			await prepareClose();
			reset();
		},
		applyTheme(next: AppThemeId) {
			theme = next;
			send({ type: "haunter/editor/theme", theme });
			send({
				type: "haunter/editor/context-support",
				available: bridge.canUseContext(),
			});
		},
		dispose() {
			clearTimeout(loadingTimer);
			if (flush) {
				clearTimeout(flush.timer);
				flush.reject(new Error("The editor was closed."));
				flush = undefined;
			}
			window.removeEventListener("message", listener);
		},
	};
}
