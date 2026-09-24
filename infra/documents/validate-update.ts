import * as Y from "yjs";
import { CreatePageInputSchema } from "@/features/pages/schemas";
import { projectPageBody } from "./codec";
import {
	assertMovePreservesBlocks,
	documentBlockIds,
	reconcileBlockMoves,
} from "./move-conflicts";

const contentSchema = CreatePageInputSchema.shape.initialContent.unwrap();
export function validateDocumentState(document: Y.Doc) {
	if (Y.encodeStateAsUpdate(document).length > 8 * 1024 * 1024)
		throw new Error("Document exceeds the 8 MiB limit");
	const content = contentSchema.parse(projectPageBody(document));
	const ids = new Set<string>();
	const visit = (blocks: typeof content) => {
		for (const block of blocks) {
			if (ids.has(block.id)) throw new Error("Duplicate block ID");
			ids.add(block.id);
			visit(block.children);
		}
	};
	visit(content);
	return content;
}

/** Validate a candidate before mutating or broadcasting the shared document. */
export function validateDocumentUpdate(document: Y.Doc, update: Uint8Array) {
	const candidate = new Y.Doc();
	try {
		Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document));
		Y.applyUpdate(candidate, update);
		validateDocumentState(candidate);
	} finally {
		candidate.destroy();
	}
}

/** Return the original update plus any safe move repairs as one atomic update. */
export function prepareDocumentUpdate(document: Y.Doc, update: Uint8Array) {
	const candidate = new Y.Doc();
	try {
		Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document));
		Y.applyUpdate(candidate, update);
		const repaired = reconcileBlockMoves(candidate);
		// Native editor moves may reuse XML nodes and swap their logical IDs.
		// Never deduplicate a merge that also erased an unrelated block.
		if (repaired)
			assertMovePreservesBlocks(documentBlockIds(document), candidate);
		validateDocumentState(candidate);
		return {
			repaired,
			update: repaired
				? Y.encodeStateAsUpdate(candidate, Y.encodeStateVector(document))
				: update,
		};
	} finally {
		candidate.destroy();
	}
}
