import type { QueryClient } from "@tanstack/react-query";
import {
	invalidateCanvasNavigation,
	invalidateCanvases,
} from "@/features/canvases/client/queries";
import {
	invalidateBacklinks,
	invalidatePageNavigation,
	invalidatePages,
} from "@/features/pages/client/queries";
import { invalidateTasksWhenIdle } from "@/features/tasks/client/queries";

export async function invalidateRecoveryImport(
	queryClient: QueryClient,
	workspaceId: string,
) {
	await Promise.all([
		invalidatePages(queryClient),
		invalidatePageNavigation(queryClient, workspaceId),
		invalidateTasksWhenIdle(queryClient),
		invalidateBacklinks(queryClient),
		invalidateCanvases(queryClient),
		invalidateCanvasNavigation(queryClient, workspaceId),
	]);
}
