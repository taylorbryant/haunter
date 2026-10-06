import type { QueryClient } from "@tanstack/react-query";
import { waitForTaskWrites } from "@/features/tasks/client/wait-for-task-writes";
import { draftRegistry } from "@/client/draft-registry";
import { flushPendingCanvasSave } from "@/features/canvases/client/save-state";
import { flushPendingPageSave } from "@/features/pages/client/save-state";
import { waitForEmbeddedAppearanceWrites } from "./embedded-appearance";

/** A workspace switch may release the credential, so wait for acknowledged saves. */
export async function flushEmbeddedWorkspace(
	queryClient: QueryClient,
	workspaceId: string,
	pageId?: string,
	canvasId?: string,
) {
	if (document.activeElement instanceof HTMLElement)
		document.activeElement.blur();
	const locallySaved = await draftRegistry.flushLocal().catch(() => false);
	const pages = new Set(pageId ? [pageId] : []);
	const canvases = new Set(canvasId ? [canvasId] : []);
	for (const entry of draftRegistry.entries()) {
		if (entry.identity.workspaceId !== workspaceId) continue;
		if (entry.identity.resourceType === "page")
			pages.add(entry.identity.resourceId);
		if (entry.identity.resourceType === "canvas")
			canvases.add(entry.identity.resourceId);
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const saved = await Promise.race([
			Promise.all([
				waitForEmbeddedAppearanceWrites(queryClient),
				waitForTaskWrites(queryClient, workspaceId),
				...[...pages].map(flushPendingPageSave),
				...[...canvases].map(flushPendingCanvasSave),
			])
				.then((results) => results.every(Boolean))
				.catch(() => false),
			new Promise<boolean>((resolve) => {
				timer = setTimeout(() => resolve(false), 5000);
			}),
		]);
		return { locallySaved, saved };
	} finally {
		clearTimeout(timer);
	}
}
