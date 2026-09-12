import type { DocumentRepository } from "@/features/documents/ports";
import type { TaskSourceDocumentPort } from "@/features/tasks/ports";
import { toTaskBlockProps } from "@/features/tasks/lib/patch-task-block";

/** Shares the task use case's transaction, including notifications. */
export function createCollaborativeTaskSourceDocuments(
	documents: DocumentRepository,
): TaskSourceDocumentPort {
	return {
		async patchTaskBlock(scope, input) {
			const result = await documents.patchBlockProps(scope, {
				pageId: input.pageId,
				blockId: input.blockId,
				blockType: "task",
				props: toTaskBlockProps(input.patch),
			});
			return {
				pageId: input.pageId,
				pageContentUpdatedAt: result.contentUpdatedAt,
			};
		},
	};
}
