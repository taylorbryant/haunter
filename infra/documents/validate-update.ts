import * as Y from "yjs";
import { CreatePageInputSchema } from "@/features/pages/schemas";
import { projectPageBody } from "./codec";

const contentSchema = CreatePageInputSchema.shape.initialContent.unwrap();
/** Validate a candidate before mutating or broadcasting the shared document. */
export function validateDocumentUpdate(document: Y.Doc, update: Uint8Array) {
	const candidate = new Y.Doc();
	try {
		Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document));
		Y.applyUpdate(candidate, update);
		if (Y.encodeStateAsUpdate(candidate).length > 8 * 1024 * 1024)
			throw new Error("Document exceeds the 8 MiB limit");
		const content = contentSchema.parse(projectPageBody(candidate));
		const ids = new Set<string>();
		const visit = (blocks: typeof content) => {
			for (const block of blocks) {
				if (ids.has(block.id)) throw new Error("Duplicate block ID");
				ids.add(block.id);
				visit(block.children);
			}
		};
		visit(content);
	} finally {
		candidate.destroy();
	}
}
