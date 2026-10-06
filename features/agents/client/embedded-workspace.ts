import { isEmbeddedEditorOrigin } from "../embedded-editor-origin.js";
import { PageListSchema } from "../mcp-app/schemas";
import { WorkspaceActionResultSchema } from "../mcp-app/workspace-schema";
import type { EditorWorkspaceRequest } from "../mcp-app/editor-schema";

/** Replies are bound to this frame's exact host, navigation nonce and request ID. */
function requestWorkspace(request: EditorWorkspaceRequest): Promise<unknown> {
	const params = new URLSearchParams(window.location.search);
	const origin = params.get("parentOrigin");
	const nonce = params.get("nonce");
	if (
		!origin ||
		!nonce ||
		!isEmbeddedEditorOrigin(origin) ||
		window.parent === window
	)
		return Promise.reject(new Error("Reopen Haunter to reconnect."));
	const requestId = crypto.randomUUID();
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timer);
			window.removeEventListener("message", onMessage);
			window.removeEventListener("pagehide", onClose);
		};
		const onClose = () => {
			cleanup();
			reject(new Error("The editor was closed."));
		};
		const onMessage = (event: MessageEvent) => {
			if (
				event.source !== window.parent ||
				event.origin !== origin ||
				event.data?.nonce !== nonce ||
				event.data?.type !== "haunter/editor/workspace-result" ||
				event.data?.requestId !== requestId
			)
				return;
			cleanup();
			if (typeof event.data.error === "string")
				reject(new Error(event.data.error));
			else resolve(event.data.result);
		};
		const timer = setTimeout(() => {
			cleanup();
			reject(
				new Error(
					"Haunter did not confirm this action. Refresh the page list before trying again.",
				),
			);
		}, 20_000);
		window.addEventListener("message", onMessage);
		window.addEventListener("pagehide", onClose, { once: true });
		window.parent.postMessage(
			{ type: "haunter/editor/workspace-request", nonce, requestId, request },
			origin,
		);
	});
}
export async function listEmbeddedPages() {
	return PageListSchema.parse(await requestWorkspace({ action: "list-pages" }))
		.pages;
}
export async function createEmbeddedItem(
	action: "create-page" | "create-canvas",
) {
	return WorkspaceActionResultSchema.parse(await requestWorkspace({ action }));
}
