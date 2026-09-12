import { createEmbeddedTaskProjectionPort } from "../lib/task-integration-ports";
import { extractDocumentSearchText } from "@/features/content/document-text";
import { appError } from "@/features/shared/errors";
import { patchTaskBlock } from "../lib/patch-task-block";
import type {
	EmbeddedTaskProjectionDependencies,
	EmbeddedTaskProjectionPort,
	TaskSourceDocumentPort,
} from "../ports";
import type { TenantScope } from "@beignet/core/ports";
import type { BlockJson } from "@/features/content/schemas";
type TaskSourceDocumentRepository = {
	findById(
		scope: TenantScope,
		id: string,
	): Promise<{
		id: string;
		content: BlockJson[];
		contentUpdatedAt: string;
	} | null>;
	saveContentIf(
		scope: TenantScope,
		id: string,
		contentJson: string,
		searchText: string,
		baseUpdatedAt: string,
	): Promise<{ updatedAt: string; contentUpdatedAt: string } | null>;
};
const TASK_BLOCK_PATCH_ATTEMPTS = 3;
export function createTaskSourceDocumentPort(
	documents: TaskSourceDocumentRepository,
): TaskSourceDocumentPort {
	return {
		async patchTaskBlock(scope, input) {
			let page = await documents.findById(scope, input.pageId);

			for (
				let attempt = 0;
				page && attempt < TASK_BLOCK_PATCH_ATTEMPTS;
				attempt += 1
			) {
				const patched = patchTaskBlock(
					page.content,
					input.blockId,
					input.patch,
				);
				if (!patched.found) return null;

				const saved = await documents.saveContentIf(
					scope,
					page.id,
					JSON.stringify(patched.blocks),
					extractDocumentSearchText(patched.blocks),
					page.contentUpdatedAt,
				);
				if (saved) {
					return {
						pageId: page.id,
						pageContentUpdatedAt: saved.contentUpdatedAt,
					};
				}

				page = await documents.findById(scope, input.pageId);
			}

			if (page) {
				throw appError("StaleWrite", { details: { id: input.pageId } });
			}
			return null;
		},
	};
}

export function createTaskIntegrationPorts(
	dependencies: EmbeddedTaskProjectionDependencies & {
		documents: TaskSourceDocumentRepository;
	},
): {
	pageTaskProjection: EmbeddedTaskProjectionPort;
	taskSourceDocuments: TaskSourceDocumentPort;
} {
	return {
		pageTaskProjection: createEmbeddedTaskProjectionPort(dependencies),
		taskSourceDocuments: createTaskSourceDocumentPort(dependencies.documents),
	};
}
