import type {
	PageLinkRepository,
	PageRepository,
} from "@/features/pages/ports";
import type { BlockJson, PageMeta } from "@/features/pages/schemas";
import { reconcilePageTasks } from "@/features/tasks/lib/reconcile-page-tasks";
import type { TaskRepository } from "@/features/tasks/ports";
import { extractPageLinks } from "./extract-page-links";

/**
 * Reconcile everything a page document is the source of truth for: its task
 * rows and its outgoing page links. Shared by the content-save and
 * version-restore paths so a restored document never leaves stale tasks or
 * links behind.
 */
export async function reconcilePageDerivations(
	tx: {
		pages: Pick<PageRepository, "findMetaById">;
		pageLinks: PageLinkRepository;
		tasks: TaskRepository;
	},
	page: PageMeta,
	content: BlockJson[],
): Promise<void> {
	await reconcilePageTasks(tx.tasks, page, content);

	// Keep only link targets that still exist and live in the same workspace
	// (purged or foreign ids would break the link table's foreign keys).
	const targets: string[] = [];
	for (const targetId of extractPageLinks(content)) {
		if (targetId === page.id) continue;
		const target = await tx.pages.findMetaById(targetId);
		if (target && target.workspaceId === page.workspaceId) {
			targets.push(targetId);
		}
	}
	await tx.pageLinks.replaceForSource(page.id, page.userId, targets);
}
