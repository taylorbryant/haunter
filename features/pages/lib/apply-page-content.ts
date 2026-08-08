import type { TenantScope } from "@beignet/core/ports";
import { extractPageLinks } from "@/features/content/page-links";
import type { BlockJson } from "@/features/content/schemas";
import type { Notification } from "@/features/notifications/schemas";
import type {
	PageLinkRepository,
	PageRepository,
} from "@/features/pages/ports";
import type { PageMeta } from "@/features/pages/schemas";
import type {
	EmbeddedTaskProjectionPort,
	TaskAssignmentActor,
} from "@/features/tasks/ports";

/** Keep the materialized backlink index in sync with a page document. */
export async function reconcilePageLinks(
	tx: {
		pages: Pick<PageRepository, "findMetaByIds">;
		pageLinks: PageLinkRepository;
	},
	scope: TenantScope,
	page: PageMeta,
	content: BlockJson[],
): Promise<boolean> {
	// Keep only link targets that still exist and live in the same workspace
	// (purged or foreign ids would break the link table's foreign keys).
	const targetIds = extractPageLinks(content).filter(
		(targetId) => targetId !== page.id,
	);
	const targets = await tx.pages.findMetaByIds(scope, targetIds);
	const validTargets = new Set(targets.map((target) => target.id));
	return tx.pageLinks.replaceForSource(
		scope,
		page.id,
		page.userId,
		targetIds.filter((targetId) => validTargets.has(targetId)),
	);
}

/**
 * Reconcile everything a page document is the source of truth for: its task
 * rows and its outgoing page links. Shared by the content-save and
 * version-restore paths so a restored document never leaves stale tasks or
 * links behind.
 */
export async function reconcilePageDerivations(
	tx: {
		pages: Pick<PageRepository, "findMetaByIds">;
		pageLinks: PageLinkRepository;
		pageTaskProjection: EmbeddedTaskProjectionPort;
	},
	scope: TenantScope,
	page: PageMeta,
	content: BlockJson[],
	options: {
		assignmentActor?: TaskAssignmentActor;
		assignmentUser?: {
			id: string;
			name?: string | null;
			email?: string | null;
		};
		defaultTaskAssigneeId?: string | null;
	} = {},
): Promise<{
	tasksChanged: boolean;
	linksChanged: boolean;
	assignmentNotifications: Notification[];
}> {
	const taskResult = await tx.pageTaskProjection.reconcile(
		scope,
		{ id: page.id, userId: page.userId, content },
		{
			assignmentActor: options.assignmentActor,
			assignmentUser: options.assignmentUser,
			defaultAssigneeId: options.defaultTaskAssigneeId,
		},
	);

	const linksChanged = await reconcilePageLinks(tx, scope, page, content);

	return {
		tasksChanged: taskResult.changed,
		linksChanged,
		assignmentNotifications: taskResult.assignmentNotifications,
	};
}
