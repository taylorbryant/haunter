import type { TenantScope } from "@beignet/core/ports";
import type { PageRepository, PageVersionRepository } from "../ports";

export const VERSION_RETENTION = 50;
const CHECKPOINT_INTERVAL_MS = 10 * 60 * 1000;

/** Capture the previous content in the same transaction as a page write. */
export async function checkpointPageBeforeWrite(
	tx: { pages: PageRepository; pageVersions: PageVersionRepository },
	scope: TenantScope,
	pageId: string,
	userId: string | null,
) {
	const latest = await tx.pageVersions.latestCreatedAt(scope, pageId);
	if (latest && Date.now() - Date.parse(latest) < CHECKPOINT_INTERVAL_MS)
		return;
	const page = await tx.pages.findById(scope, pageId);
	if (!page?.content.length) return;
	await tx.pageVersions.create(scope, {
		pageId,
		title: page.title,
		icon: page.icon,
		contentJson: JSON.stringify(page.content),
		cause: "checkpoint",
		createdBy: userId,
	});
	await tx.pageVersions.prune(scope, pageId, VERSION_RETENTION);
}
