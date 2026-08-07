import "@beignet/core/server-only";
import type { TenantScope } from "@beignet/core/ports";
import { extractPageSearchText } from "@/features/pages/lib/extract-page-text";
import type { PageRepository } from "@/features/pages/ports";
import { appError } from "@/features/shared/errors";
import {
	patchTaskBlock,
	type TaskBlockPatch,
} from "@/features/tasks/lib/patch-task-block";

const TASK_BLOCK_PATCH_ATTEMPTS = 3;

export async function savePageTaskBlockPatch(
	pages: PageRepository,
	scope: TenantScope,
	input: {
		pageId: string;
		blockId: string;
		patch: TaskBlockPatch;
	},
): Promise<{ pageId: string; pageContentUpdatedAt: string } | null> {
	let page = await pages.findById(scope, input.pageId);

	for (
		let attempt = 0;
		page && attempt < TASK_BLOCK_PATCH_ATTEMPTS;
		attempt += 1
	) {
		const patched = patchTaskBlock(page.content, input.blockId, input.patch);
		// A missing block means the row is stale; the next content save will
		// orphan-delete it. Keep the task-row mutation without rewriting the page.
		if (!patched.found) return null;

		const saved = await pages.saveContentIf(
			scope,
			page.id,
			JSON.stringify(patched.blocks),
			extractPageSearchText(patched.blocks),
			page.contentUpdatedAt,
		);
		if (saved) {
			return {
				pageId: page.id,
				pageContentUpdatedAt: saved.contentUpdatedAt,
			};
		}

		page = await pages.findById(scope, input.pageId);
	}

	if (page) {
		throw appError("StaleWrite", { details: { id: input.pageId } });
	}
	return null;
}
