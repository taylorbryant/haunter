import "@beignet/core/server-only";
import type { TenantScope } from "@beignet/core/ports";
import type { PageRepository } from "@/features/pages/ports";
import { appError } from "@/features/shared/errors";

export async function assertValidPageParent(
	pages: Pick<PageRepository, "findMetaById">,
	scope: TenantScope,
	pageId: string,
	newParentId: string | null,
): Promise<void> {
	if (newParentId === null) return;

	const parent = await pages.findMetaById(scope, newParentId);
	if (!parent || parent.deletedAt !== null) {
		throw appError("PageNotFound", { details: { id: newParentId } });
	}

	let currentId: string | null = newParentId;
	const seen = new Set<string>();
	while (currentId) {
		if (currentId === pageId) {
			throw appError("InvalidPageMove", {
				details: { pageId, parentPageId: newParentId },
			});
		}
		if (seen.has(currentId)) break;
		seen.add(currentId);
		const current = await pages.findMetaById(scope, currentId);
		currentId = current?.parentPageId ?? null;
	}
}
