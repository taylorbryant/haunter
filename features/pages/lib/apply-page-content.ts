import type {
	PageLinkRepository,
	PageRepository,
} from "@/features/pages/ports";
import type { BlockJson, PageMeta } from "@/features/pages/schemas";
import type { MemberRepository } from "@/features/members/ports";
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
		members: MemberRepository;
		pages: Pick<PageRepository, "findMetaByIds">;
		pageLinks: PageLinkRepository;
		tasks: TaskRepository;
	},
	scope: TenantScope,
	page: PageMeta,
	content: BlockJson[],
	options: { defaultTaskAssigneeId?: string | null } = {},
): Promise<{ tasksChanged: boolean; linksChanged: boolean }> {
	const tasksChanged = await reconcilePageTasks(
		{ members: tx.members, tasks: tx.tasks },
		scope,
		page,
		content,
		{ defaultAssigneeId: options.defaultTaskAssigneeId },
	);

	// Keep only link targets that still exist and live in the same workspace
	// (purged or foreign ids would break the link table's foreign keys).
	const targetIds = extractPageLinks(content).filter(
		(targetId) => targetId !== page.id,
	);
	const targets = await tx.pages.findMetaByIds(scope, targetIds);
	const validTargets = new Set(targets.map((target) => target.id));
	const linksChanged = await tx.pageLinks.replaceForSource(
		scope,
		page.id,
		page.userId,
		targetIds.filter((targetId) => validTargets.has(targetId)),
	);

	return { tasksChanged, linksChanged };
}
import type { TenantScope } from "@beignet/core/ports";
