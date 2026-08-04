import type * as Y from "yjs";
import { activePageGeneration, pageTaskAttributionsName } from "./model";

export type PageTaskAttributionOperation = {
	blockId: string;
	operationId: string | null;
};

/** Store the authenticated request's nonce alongside the assignment change in
 * the authoritative document. Materialization accepts an attribution only
 * when both halves converge on the same operation id. */
export function setPageTaskAttributionOperations(
	doc: Y.Doc,
	operations: readonly PageTaskAttributionOperation[],
): void {
	if (operations.length === 0) return;
	const operationMap = doc.getMap<string>(
		pageTaskAttributionsName(activePageGeneration(doc)),
	);
	doc.transact(() => {
		for (const operation of operations) {
			if (operation.operationId === null)
				operationMap.delete(operation.blockId);
			else operationMap.set(operation.blockId, operation.operationId);
		}
	});
}

export function pageTaskAttributionOperations(doc: Y.Doc): Map<string, string> {
	return new Map(
		doc
			.getMap<string>(pageTaskAttributionsName(activePageGeneration(doc)))
			.entries(),
	);
}
