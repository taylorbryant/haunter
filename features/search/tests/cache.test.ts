import { expect, test } from "bun:test";
import { QueryClient, matchQuery } from "@tanstack/react-query";
import { workspaceEventQueries } from "@/features/collab/client/workspace-event-cache";
import {
	createWorkspaceCanvasEvent,
	createWorkspacePageEvent,
	createWorkspaceTaskEvent,
} from "@/features/collab/workspace-events";
import { invalidatePageSearch } from "@/features/pages/client/queries";
import { invalidateCanvases } from "@/features/canvases/client/queries";
import { invalidateTasks } from "@/features/tasks/client/queries";
import { searchWorkspaceQueryOptions } from "../client/queries";

test("workspace events refresh paginated search without invalidating another workspace", async () => {
	const cache = new QueryClient();
	try {
		const a = searchWorkspaceQueryOptions("a", "needle", "all");
		const b = searchWorkspaceQueryOptions("b", "needle", "all");
		const empty = {
			pages: [{ items: [], nextCursor: null }],
			pageParams: [undefined],
		};
		cache.setQueryData(a.queryKey, empty);
		cache.setQueryData(b.queryKey, empty);
		for (const event of [
			createWorkspacePageEvent({
				workspaceId: "a",
				pageId: crypto.randomUUID(),
				type: "page.contentChanged",
			}),
			createWorkspaceCanvasEvent({
				workspaceId: "a",
				canvasId: crypto.randomUUID(),
				pageId: null,
			}),
			createWorkspaceTaskEvent({
				workspaceId: "a",
				taskId: crypto.randomUUID(),
			}),
		]) {
			const filters = workspaceEventQueries("a", event);
			expect(
				filters.some((filter) =>
					matchQuery(
						filter,
						cache.getQueryCache().find({ queryKey: a.queryKey })!,
					),
				),
			).toBeTrue();
			expect(
				filters.some((filter) =>
					matchQuery(
						filter,
						cache.getQueryCache().find({ queryKey: b.queryKey })!,
					),
				),
			).toBeFalse();
		}
		for (const invalidate of [
			invalidatePageSearch,
			invalidateCanvases,
			invalidateTasks,
		]) {
			cache.setQueryData(a.queryKey, empty);
			await invalidate(cache);
			expect(cache.getQueryState(a.queryKey)?.isInvalidated).toBeTrue();
		}
	} finally {
		cache.clear();
	}
});
