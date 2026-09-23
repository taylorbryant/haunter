import type { DocumentRepository } from "../ports";
import type { PageRepository } from "@/features/pages/ports";

/** Read-only document tokens for lightweight agent tests that use in-memory pages. */
export function createTestDocumentReader(
	pages: PageRepository,
): DocumentRepository {
	const unsupported = async (): Promise<never> => {
		throw new Error("Use a real document fixture for document writes.");
	};
	return {
		async find(scope, pageId) {
			const page = await pages.findById(scope, pageId);
			return page
				? {
						pageId,
						state: new Uint8Array(),
						revision: Date.parse(page.contentUpdatedAt),
						generation: 0,
					}
				: null;
		},
		assertWorkerLease: unsupported,
		getGeneration: unsupported,
		restoreBody: unsupported,
		findChanged: unsupported,
		appendBlocks: unsupported,
		patchBlockProps: unsupported,
		editBlocks: unsupported,
		insert: unsupported,
		commit: unsupported,
	};
}
