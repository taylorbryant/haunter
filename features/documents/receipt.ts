import * as Y from "yjs";

export type PersistenceReceipt = { vector: number[]; deletions: number[] };

/** State vectors omit deletions. Include the delete set to acknowledge delete-only edits. */
export function createPersistenceReceipt(doc: Y.Doc): PersistenceReceipt {
	const vector = Y.encodeStateVector(doc);
	return {
		vector: Array.from(vector),
		deletions: Array.from(Y.encodeStateAsUpdate(doc, vector)),
	};
}

export function receiptCoversDocument(
	doc: Y.Doc,
	receipt: PersistenceReceipt,
): boolean {
	const remaining = Y.decodeUpdate(
		Y.encodeStateAsUpdate(doc, new Uint8Array(receipt.vector)),
	);
	if (remaining.structs.length) return false;
	const persisted = Y.decodeUpdate(new Uint8Array(receipt.deletions)).ds
		.clients;
	for (const [client, deletions] of remaining.ds.clients) {
		const ranges = persisted.get(client) ?? [];
		for (const deletion of deletions) {
			if (
				!ranges.some(
					(range) =>
						range.clock <= deletion.clock &&
						range.clock + range.len >= deletion.clock + deletion.len,
				)
			)
				return false;
		}
	}
	return true;
}
