import type { TestPageRepository } from "@/features/pages/tests/helpers";
import type { DocumentRepository } from "../ports";
import { assertDocumentRevision } from "../revision";

/** Page-backed fake for use-case tests. Yjs writes use real document fixtures. */
export function createTestDocumentRepository(
	pages: TestPageRepository,
): DocumentRepository {
	const generations = new Map<string, number>();
	const unsupported = async (): Promise<never> => {
		throw new Error("Use a real document fixture for this document operation.");
	};
	const repository: DocumentRepository = {
		async find(scope, pageId) {
			const page = await pages.findById(scope, pageId);
			return page
				? {
						pageId,
						state: new Uint8Array(),
						revision: Date.parse(page.contentUpdatedAt),
						generation: generations.get(pageId) ?? 0,
					}
				: null;
		},
		async restoreBody(scope, pageId, content, expectedRevision) {
			const stored = await repository.find(scope, pageId);
			if (!stored) throw new Error("Page document not found");
			assertDocumentRevision(stored, expectedRevision);
			const saved = await pages.saveContent(
				scope,
				pageId,
				JSON.stringify(content),
				"",
			);
			const generation = stored.generation + 1;
			generations.set(pageId, generation);
			return {
				...saved,
				content,
				generation,
				revision: Date.parse(saved.contentUpdatedAt),
			};
		},
		async appendBlocks(scope, pageId, blocks) {
			for (let attempt = 0; attempt < 3; attempt++) {
				const page = await pages.findById(scope, pageId);
				if (!page || page.deletedAt !== null) throw new Error("Page not found");
				const content = [...page.content, ...blocks];
				const saved = await pages.saveContentIf(
					scope,
					pageId,
					JSON.stringify(content),
					"",
					page.contentUpdatedAt,
				);
				if (saved)
					return {
						...saved,
						content,
						generation: generations.get(pageId) ?? 0,
						revision: Date.parse(saved.contentUpdatedAt),
					};
			}
			throw new Error("Stale append");
		},
		assertWorkerLease: unsupported,
		getGeneration: unsupported,
		findChanged: unsupported,
		patchBlockProps: unsupported,
		editBlocks: unsupported,
		insert: unsupported,
		commit: unsupported,
	};
	return repository;
}
