"use client";
import { type ReactNode, useEffect } from "react";
import { draftRegistry } from "@/client/draft-registry";
import { useCurrentUser } from "@/components/app-session-provider";
import { useEmbeddedHostTheme } from "@/components/theme-provider";
import { getAppTheme } from "@/lib/themes";
import { flushPendingCanvasSave } from "@/features/canvases/client/save-state";
import { flushPendingPageSave } from "@/features/pages/client/save-state";
import { isEmbeddedEditorOrigin } from "../embedded-editor-origin.js";

type EmbeddedBridge = { origin: string; nonce: string };
export function readBridge(): EmbeddedBridge | null {
	if (window.parent === window) return null;
	const query = new URLSearchParams(window.location.search);
	const origin = query.get("parentOrigin");
	const nonce = query.get("nonce");
	if (
		!origin ||
		!isEmbeddedEditorOrigin(origin) ||
		!nonce ||
		nonce.length > 100
	)
		return null;
	return { origin, nonce };
}
export function send(
	bridge: EmbeddedBridge | null,
	message: Record<string, unknown>,
) {
	if (bridge)
		window.parent.postMessage(
			{ ...message, nonce: bridge.nonce },
			bridge.origin,
		);
}

/** Only the shell is new. PageEditor retains its ordinary APIs and document session. */
export function EmbeddedEditorFrame({
	status,
	pageId,
	canvasId,
	onContextSupport,
	children,
}: {
	status: "opening" | "ready" | "sign-in-required" | "access-denied";
	pageId?: string;
	canvasId?: string;
	children: ReactNode;
	onContextSupport?: (available: boolean) => void;
}) {
	const user = useCurrentUser();
	const userId = user?.id;
	const setHostTheme = useEmbeddedHostTheme();
	useEffect(() => {
		const bridge = readBridge();
		send(bridge, { type: "haunter/editor/status", status });
		let active = true;
		const message = async (event: MessageEvent) => {
			if (
				!bridge ||
				event.source !== window.parent ||
				event.origin !== bridge.origin ||
				event.data?.nonce !== bridge.nonce
			)
				return;
			if (event.data?.type === "haunter/editor/theme") {
				const theme = getAppTheme(event.data.theme);
				if (theme) setHostTheme?.(theme.id);
			}
			if (event.data?.type === "haunter/editor/context-support")
				onContextSupport?.(event.data.available === true);
			if (event.data?.type === "haunter/editor/resume") {
				document.body.inert = false;
				return;
			}
			if (
				event.data?.type !== "haunter/editor/flush" ||
				typeof event.data.requestId !== "string"
			)
				return;
			const requestId = event.data.requestId;
			if (event.data.pause) {
				// Blur commits active title/input edits before freezing keyboard and pointer
				// input. Keep it frozen until the parent replaces the frame or resumes it.
				if (document.activeElement instanceof HTMLElement)
					document.activeElement.blur();
				document.body.inert = true;
			}
			let locallySaved = true;
			let saved = true;
			if (userId) {
				locallySaved = await draftRegistry
					.flushLocal(userId)
					.catch(() => false);
				let timer: ReturnType<typeof setTimeout> | undefined;
				saved = await Promise.race([
					(canvasId
						? flushPendingCanvasSave(canvasId)
						: pageId
							? Promise.all([
									flushPendingPageSave(pageId),
									...draftRegistry
										.entries(userId)
										.filter((entry) => entry.identity.resourceType === "canvas")
										.map((entry) =>
											flushPendingCanvasSave(entry.identity.resourceId),
										),
								]).then((results) => results.every(Boolean))
							: Promise.resolve(false)
					).catch(() => false),
					new Promise<boolean>((resolve) => {
						timer = setTimeout(() => resolve(false), 5000);
					}),
				]);
				clearTimeout(timer);
			}
			if (active)
				send(bridge, {
					type: "haunter/editor/flushed",
					requestId,
					locallySaved,
					saved,
				});
		};
		const listener = (event: MessageEvent) => {
			void message(event).catch(() => {
				send(bridge, {
					type: "haunter/editor/flushed",
					requestId: event.data?.requestId,
					locallySaved: false,
					saved: false,
				});
			});
		};
		window.addEventListener("message", listener);
		return () => {
			active = false;
			window.removeEventListener("message", listener);
		};
	}, [status, pageId, canvasId, userId, setHostTheme, onContextSupport]);
	return (
		<main
			className="isolate min-h-svh overflow-x-clip bg-background text-foreground"
			data-haunter-embedded-editor
		>
			{children}
		</main>
	);
}
