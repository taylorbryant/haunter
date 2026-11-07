import type { PageMeta } from "@/features/pages/schemas";

export function preloadHaunterEditor() {
	// Prioritize document setup before the bulk editor download competes with
	// the create response and route/title chunks on slow connections. This only
	// loads code; opening a session still requires a confirmed page and auth.
	return import("@/features/documents/client/session").then(
		() => import("@/features/pages/components/editor/haunter-editor"),
	);
}

/** Connect a confirmed new page while its Next route is still loading. */
export async function preloadCreatedPageDocument(page: PageMeta) {
	const url = process.env.NEXT_PUBLIC_COLLABORATION_URL;
	if (typeof window === "undefined" || !url) return;
	const { acquirePageDocument } = await import(
		"@/features/documents/client/session"
	);
	const { release } = acquirePageDocument({
		userId: page.userId,
		workspaceId: page.workspaceId,
		pageId: page.id,
		url,
	});
	// The session cache keeps released sessions warm for one minute. The editor
	// acquires the same session on arrival; abandoned navigation still cleans up.
	release();
}
